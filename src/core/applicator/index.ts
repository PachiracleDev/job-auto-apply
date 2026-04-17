import type { Browser } from "playwright-core";
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
import { bundleCvArtifacts, renderCvPdf } from "@/core/cv/renderer.js";
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
  let browser: Browser | undefined;
  let context: Awaited<ReturnType<typeof launchBrowser>>["context"] | undefined;
  try {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY es obligatoria en .env para generar CV y ejecutar el pipeline.",
      );
    }
    await initDataLayer();
    const profile = loadProfile();

    if (!sessionFileExists()) {
      throw new Error(
        "No hay sesión de LinkedIn. Ejecuta `pnpm login` antes de `pnpm run`.",
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
        "La sesión de LinkedIn no es válida. Vuelve a ejecutar `pnpm login`.",
      );
    }

    const page = await context.newPage();
    const rawJobs = await scrapeLinkedInJobList(page, {
      query: profile.searchQuery,
      location: profile.searchLocation,
      maxJobs: options.maxJobs,
    });

    for (const raw of rawJobs) {
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

        const cvMd = await generateTailoredCvMarkdown(profile, job);
        const cover = await generateCoverLetter(profile, job);
        const cvData: CVData = {
          jobPostId: job.id,
          content: cvMd,
          generatedAt: new Date(),
        };
        saveCvRecord(cvData);

        const baseName = `cv-${job.id}`;
        const pdfPath = await renderCvPdf(cvData, baseName);
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
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}
