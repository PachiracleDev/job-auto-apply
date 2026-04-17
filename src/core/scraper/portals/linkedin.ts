import { createHash } from "node:crypto";
import type { Page } from "playwright-core";
import { linkedinPortal } from "@/config/portals.js";
import type { JobPost } from "@/types/index.js";
import { humanDelay, randomDelay } from "@/utils/delay.js";
import { extractArticleFromHtml } from "@/core/scraper/extractor.js";
import { logger } from "@/utils/logger.js";

export function jobIdFromUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 32);
}

function pickFirstText(page: Page, selectors: string[]): Promise<string> {
  return (async () => {
    for (const sel of selectors.filter((s) => s.length > 0)) {
      const loc = page.locator(sel).first();
      const count = await loc.count();
      if (count > 0) {
        const t = (await loc.innerText()).trim();
        if (t) return t;
      }
    }
    return "";
  })();
}

export interface ScrapeLinkedInJobsOptions {
  query: string;
  location: string;
  maxJobs: number;
}

export async function scrapeLinkedInJobList(
  page: Page,
  options: ScrapeLinkedInJobsOptions,
): Promise<JobPost[]> {
  const results: JobPost[] = [];
  try {
    const url = linkedinPortal.searchUrl(options.query, options.location);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await randomDelay();

    if (page.url().includes("login") || page.url().includes("checkpoint")) {
      throw new Error(
        "LinkedIn requiere inicio de sesión. Ejecuta `pnpm login` y guarda la sesión.",
      );
    }

    const cardSelector = linkedinPortal.selectors["jobCard"];
    await page.locator(cardSelector).first().waitFor({ timeout: 60000 }).catch(() => {
      logger.warn("No se encontraron tarjetas de empleo con el selector actual.");
    });

    const cards = await page.locator(cardSelector).all();
    const jobLinks: string[] = [];

    for (const card of cards) {
      if (jobLinks.length >= options.maxJobs) break;
      const link = card.locator('a[href*="/jobs/view/"]').first();
      if ((await link.count()) === 0) continue;
      const href = await link.getAttribute("href");
      if (!href) continue;
      const absolute = href.startsWith("http")
        ? href
        : `https://www.linkedin.com${href}`;
      if (!jobLinks.includes(absolute)) {
        jobLinks.push(absolute.split("?")[0] ?? absolute);
      }
    }

    for (const jobUrl of jobLinks) {
      if (results.length >= options.maxJobs) break;
      try {
        await page.goto(jobUrl, { waitUntil: "domcontentloaded" });
        await humanDelay();

        const title = await pickFirstText(page, [
          ".job-details-jobs-unified-top-card__job-title",
          "h1",
          linkedinPortal.selectors["jobTitleLink"] ?? "",
        ]);

        const company = await pickFirstText(page, [
          ".job-details-jobs-unified-top-card__company-name a",
          ".job-details-jobs-unified-top-card__company-name",
          linkedinPortal.selectors["companyName"] ?? "",
        ]);

        const location = await pickFirstText(page, [
          ".job-details-jobs-unified-top-card__bullet",
          linkedinPortal.selectors["jobLocation"] ?? "",
        ]);

        const html = await page.content();
        const article = extractArticleFromHtml(html);
        const description =
          article?.textContent ??
          (await pickFirstText(page, [linkedinPortal.selectors["jobDescription"] ?? ""]));

        const id = jobIdFromUrl(jobUrl);
        const post: JobPost = {
          id,
          title: title || "Sin título",
          company: company || "Empresa desconocida",
          location: location || options.location,
          description: description || "",
          url: jobUrl,
          portal: "linkedin",
          scrapedAt: new Date(),
        };
        results.push(post);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        logger.warn(`No se pudo extraer el empleo ${jobUrl}: ${err.message}`);
      }
    }

    return results;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error("scrapeLinkedInJobList: " + err.message);
    throw err;
  }
}
