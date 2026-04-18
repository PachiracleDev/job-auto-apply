import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { env } from "@/config/env.js";
import { loadProfile } from "@/config/profile.js";
import { initDataLayer } from "@/data/db.js";
import {
  buildDedupText,
  isNearDuplicate,
  saveProcessedJob,
} from "@/data/jobStore.js";
import { embedText } from "@/utils/embeddings.js";
import {
  insertApplication,
  updateApplicationStatus,
} from "@/data/appStore.js";
import { launchBrowser } from "@/core/scraper/browser.js";
import { validateLinkedInSession } from "@/core/session/validator.js";
import {
  getLinkedInSessionPath,
  saveSession,
  sessionFileExists,
} from "@/core/session/manager.js";
import { applyLinkedInEasyApply } from "@/core/applicator/portals/linkedin.js";
import type { JobListingSnapshot, JobPost } from "@/types/index.js";
import { humanDelay, longDelay } from "@/utils/delay.js";
import { logger } from "@/utils/logger.js";

const jobRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  country: z.string().optional(),
  requirements: z.string(),
  applicantsLabel: z.string().optional(),
  postedLabel: z.string().optional(),
  url: z.string().url(),
  applyUrl: z.string().url(),
  easyApplyVerifiedOnPage: z.boolean().optional(),
  scrapedAt: z.string(),
});

const collectedJobsSchema = z.object({
  jobs: z.array(jobRowSchema),
});

export interface RunApplyFromJsonOptions {
  jsonPath: string;
  maxJobs: number;
  dryRun: boolean;
  /** Sobrescribe DEFAULT_CV_PDF / ruta del PDF adjunto en el formulario. */
  cvPdfPath?: string;
}

function listingToJobPost(listing: JobListingSnapshot): JobPost {
  return {
    id: listing.id,
    title: listing.title,
    company: listing.company,
    location: listing.location,
    description: listing.requirements,
    url: listing.url,
    portal: "linkedin",
    scrapedAt: new Date(listing.scrapedAt),
  };
}

function attachVector(post: JobPost): JobPost {
  const vector = embedText(buildDedupText(post));
  return { ...post, vector };
}

function loadCollectedJobs(pathAbs: string): JobListingSnapshot[] {
  const raw = readFileSync(pathAbs, "utf-8");
  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    throw new Error(`JSON inválido: ${err.message}`);
  }
  const parsed = collectedJobsSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      "Formato de archivo incorrecto: se espera { jobs: [...] } con id, applyUrl, url, requirements, etc. " +
        parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  return parsed.data.jobs.map(
    (j): JobListingSnapshot => ({
      id: j.id,
      title: j.title,
      company: j.company,
      location: j.location,
      country: j.country ?? "",
      requirements: j.requirements,
      applicantsLabel: j.applicantsLabel ?? "",
      postedLabel: j.postedLabel ?? "",
      url: j.url,
      applyUrl: j.applyUrl,
      easyApply: true,
      easyApplyVerifiedOnPage: j.easyApplyVerifiedOnPage ?? false,
      scrapedAt: j.scrapedAt,
    }),
  );
}

/**
 * Fase 2: postula usando `applyUrl` de cada entrada del JSON generado por `collect`.
 */
export async function runApplyFromJsonPipeline(
  options: RunApplyFromJsonOptions,
): Promise<void> {
  const jsonAbs = resolve(process.cwd(), options.jsonPath.trim());
  const listings = loadCollectedJobs(jsonAbs).slice(0, options.maxJobs);

  if (listings.length === 0) {
    logger.warn("No hay ofertas en el JSON (o max-jobs = 0).");
    return;
  }

  let browser: Awaited<ReturnType<typeof launchBrowser>>["browser"] | undefined;
  let context: Awaited<ReturnType<typeof launchBrowser>>["context"] | undefined;

  try {
    await initDataLayer();
    const profile = loadProfile();

    if (!sessionFileExists()) {
      throw new Error(
        "No hay sesión de LinkedIn. Ejecuta `pnpm cli -- login` antes de `pnpm cli -- apply`.",
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
    const cvPdf =
      options.cvPdfPath?.trim() !== undefined && options.cvPdfPath.trim() !== ""
        ? resolve(process.cwd(), options.cvPdfPath.trim())
        : env.defaultCvPdfAbs;

    logger.info(
      `Aplicando desde ${jsonAbs}: ${String(listings.length)} oferta(s); CV: ${cvPdf}`,
    );

    for (const listing of listings) {
      const job = attachVector(listingToJobPost(listing));
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

        await applyLinkedInEasyApply(page, job, {
          dryRun: options.dryRun,
          profile,
          applyUrl: listing.applyUrl,
          cvPdfPath: cvPdf,
        });

        if (!options.dryRun) {
          updateApplicationStatus(appId, "applied", {
            appliedAt: new Date(),
            cvPath: cvPdf,
          });
          await saveProcessedJob(job);
          logger.info(
            `Postulación registrada: ${job.title} @ ${job.company} (id ${job.id})`,
          );
        } else {
          updateApplicationStatus(appId, "skipped");
          logger.info(`[dry-run] Simulado: ${job.title} @ ${job.company}`);
        }

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
    logger.error("runApplyFromJsonPipeline: " + err.message);
    throw err;
  } finally {
    if (context) {
      await context.close().catch(() => undefined);
    }
    await browser?.close().catch(() => undefined);
  }
}
