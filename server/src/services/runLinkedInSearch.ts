import {
  launchBrowser,
  type InMemoryStorageState,
} from "../../../src/core/scraper/browser.js";
import { validateLinkedInSession } from "../../../src/core/session/validator.js";
import { collectLinkedInEasyApplyJobs } from "../../../src/core/scraper/portals/linkedin.js";
import type { JobListingSnapshot } from "../../../src/types/index.js";

export interface RunLinkedInSearchParams {
  storageState: InMemoryStorageState;
  /** Query OR-joined (ej. roles del body). */
  query: string;
  location: string;
  maxJobs: number;
  headless?: boolean;
}

export async function runLinkedInSearch(
  params: RunLinkedInSearchParams,
): Promise<JobListingSnapshot[]> {
  const { browser, context } = await launchBrowser({
    headless: params.headless ?? true,
    storageState: params.storageState,
  });

  try {
    const ok = await validateLinkedInSession(context);
    if (!ok) {
      throw new Error("Sesión de LinkedIn inválida o expirada.");
    }

    const page = await context.newPage();
    const listings = await collectLinkedInEasyApplyJobs(page, {
      query: params.query,
      location: params.location,
      maxJobs: params.maxJobs,
    });

    return listings;
  } finally {
    await context.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}
