import { env } from "@/config/env.js";
import { loadProfile } from "@/config/profile.js";
import { initDataLayer } from "@/data/db.js";
import {
  buildDedupText,
  isNearDuplicate,
  saveProcessedJob,
} from "@/data/jobStore.js";
import { saveCvRecord } from "@/data/cvStore.js";
import {
  insertApplication,
  updateApplicationStatus,
} from "@/data/appStore.js";
import { embedText } from "@/utils/embeddings.js";
import { launchBrowser } from "@/core/scraper/browser.js";
import { scrapeLinkedInJobList } from "@/core/scraper/portals/linkedin.js";
import { validateLinkedInSession } from "@/core/session/validator.js";
import {
  getLinkedInSessionPath,
  saveSession,
  sessionFileExists,
} from "@/core/session/manager.js";
import { applyLinkedInEasyApply } from "@/core/applicator/portals/linkedin.js";
import {
  generateCoverLetter,
  generateTailoredCvMarkdown,
} from "@/core/cv/generator.js";
import {
  bundleCvArtifacts,
  copyDefaultCvPdfToOutput,
  renderCvPdf,
} from "@/core/cv/renderer.js";
import type { CVData, JobPost } from "@/types/index.js";
import { humanDelay, longDelay } from "@/utils/delay.js";
import { logger } from "@/utils/logger.js";

export interface RunPipelineOptions {
  dryRun: boolean;
  maxJobs: number;
}

function attachVector(post: JobPost): JobPost {
  const vector = embedText(buildDedupText(post));
  return { ...post, vector };
}

export async function runApplicationPipeline(
  options: RunPipelineOptions,
): Promise<void> {
  let browser: Awaited<ReturnType<typeof launchBrowser>>["browser"] | undefined;
  let context: Awaited<ReturnType<typeof launchBrowser>>["context"] | undefined;
  try {
    await initDataLayer();
    const profile = loadProfile();

    if (!sessionFileExists()) {
      throw new Error(
        "No hay sesión de LinkedIn. Ejecuta `pnpm cli -- login` antes de `pnpm cli -- run`.",
      );
    }

    const launched = await launchBrowser({
      headless: false,
      storageStatePath: getLinkedInSessionPath(),
    });
    browser = launched.browser;
    context = launched.context;

    const ok = await validateLinkedInSession(context);
    if (!ok) {
      throw new Error(
        "La sesión de LinkedIn no es válida. Vuelve a ejecutar `pnpm cli -- login`.",
      );
    }

    const page = await context.newPage();
    const rawJobs = await scrapeLinkedInJobList(page, {
      query: profile.searchQuery,
      location: profile.searchLocation,
      maxJobs: options.maxJobs,
    });

    for (const raw of rawJobs) {
      console.log(raw);
      const job = attachVector(raw);
      let appId: string | undefined;
      try {
        if (await isNearDuplicate(job)) {
          insertApplication({
            jobPostId: job.id,
            status: "duplicate",
          });
          logger.info(`Omitido por duplicado vectorial: ${job.title}`);
          continue;
        }

        appId = insertApplication({
          jobPostId: job.id,
          status: "pending",
        });

        const cvMd = env.CV_TAILOR_WITH_AI
          ? await generateTailoredCvMarkdown(profile, job)
          : `CV base (sin personalización con IA)\n\nOrigen: ${env.DEFAULT_CV_PDF}\n\nEl PDF adjunto es una copia del archivo predeterminado.`;

        const cover = env.COVER_LETTER_WITH_AI
          ? await generateCoverLetter(profile, job)
          : `Estimado equipo de contratación,\n\nMe interesa esta posición y creo que encajo con el rol descrito.\n\nSaludos,\n${profile.fullName}`;

        const cvData: CVData = {
          jobPostId: job.id,
          content: cvMd,
          generatedAt: new Date(),
        };
        saveCvRecord(cvData);

        const baseName = `cv-${job.id}`;
        const pdfPath = env.CV_TAILOR_WITH_AI
          ? await renderCvPdf(cvData, baseName)
          : await copyDefaultCvPdfToOutput(baseName);
        cvData.pdfPath = pdfPath;

        await bundleCvArtifacts({
          baseName,
          cvMarkdown: cvMd,
          coverLetter: cover,
          pdfPath,
        });

        await applyLinkedInEasyApply(page, job, {
          dryRun: options.dryRun,
          profile,
        });

        updateApplicationStatus(appId, "applied", {
          appliedAt: new Date(),
          cvPath: pdfPath,
        });

        await saveProcessedJob(job);
        await longDelay();
        await humanDelay();
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        logger.error(`Fallo en trabajo ${job.id}: ${err.message}`);
        if (appId) {
          updateApplicationStatus(appId, "failed", { error: err.message });
        } else {
          insertApplication({
            jobPostId: job.id,
            status: "failed",
            error: err.message,
          });
        }
      }
    }

    await saveSession(context);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error("runApplicationPipeline: " + err.message);
    throw err;
  } finally {
    if (context) {
      await context.close().catch(() => undefined);
    }
    await browser?.close().catch(() => undefined);
  }
}
