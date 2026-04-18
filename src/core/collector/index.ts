import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { env } from "@/config/env.js";
import { loadProfile } from "@/config/profile.js";
import { launchBrowser } from "@/core/scraper/browser.js";
import { collectLinkedInEasyApplyJobs } from "@/core/scraper/portals/linkedin.js";
import {
  getLinkedInSessionPath,
  sessionFileExists,
} from "@/core/session/manager.js";
import { validateLinkedInSession } from "@/core/session/validator.js";
import { logger } from "@/utils/logger.js";

export interface RunCollectOptions {
  maxJobs: number;
  /** Ruta del JSON de salida (absoluta o relativa al cwd). */
  outPath?: string;
}

export async function runEasyApplyCollectPipeline(
  options: RunCollectOptions,
): Promise<string> {
  if (!sessionFileExists()) {
    throw new Error(
      "No hay sesión de LinkedIn. Ejecuta `pnpm cli -- login` antes de `pnpm cli -- collect`.",
    );
  }

  const profile = loadProfile();
  logger.info(
    `Recolección Easy Apply: "${profile.searchQuery}" en "${profile.searchLocation}" (máx. ${String(options.maxJobs)})`,
  );
  const { browser, context } = await launchBrowser({
    headless: false,
    storageStatePath: getLinkedInSessionPath(),
  });

  try {
    const ok = await validateLinkedInSession(context);
    if (!ok) {
      throw new Error(
        "La sesión de LinkedIn no es válida. Vuelve a ejecutar `pnpm cli -- login`.",
      );
    }

    const page = await context.newPage();
    const listings = await collectLinkedInEasyApplyJobs(page, {
      query: profile.searchQuery,
      location: profile.searchLocation,
      maxJobs: options.maxJobs,
    });

    const out = options.outPath?.trim()
      ? resolve(process.cwd(), options.outPath.trim())
      : resolve(
          env.outputDirAbs,
          `easy-apply-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
        );
    mkdirSync(dirname(out), { recursive: true });

    const openAiTokenUsageTotal = listings.reduce(
      (acc, j) => {
        const u = j.openAiTokenUsage;
        if (!u) return acc;
        return {
          promptTokens: acc.promptTokens + u.promptTokens,
          completionTokens: acc.completionTokens + u.completionTokens,
          totalTokens: acc.totalTokens + u.totalTokens,
        };
      },
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    );

    const payload = {
      generatedAt: new Date().toISOString(),
      searchQuery: profile.searchQuery,
      searchLocation: profile.searchLocation,
      easyApplyFilter: true,
      count: listings.length,
      ...(openAiTokenUsageTotal.totalTokens > 0
        ? {
            openAiModel: env.COLLECT_OPENAI_MODEL,
            openAiTokenUsageTotal,
          }
        : {}),
      jobs: listings,
    };
    writeFileSync(out, JSON.stringify(payload, null, 2), "utf-8");
    logger.info(
      `Guardado ${String(listings.length)} ofertas Easy Apply en: ${out}`,
    );
    return out;
  } finally {
    await context.close();
    await browser?.close().catch(() => undefined);
  }
}
