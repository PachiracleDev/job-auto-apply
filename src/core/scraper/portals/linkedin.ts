import { createHash } from "node:crypto";
import type { Page } from "playwright-core";
import { linkedinPortal } from "@/config/portals.js";
import { env } from "@/config/env.js";
import type { JobListingSnapshot, JobPost } from "@/types/index.js";
import { humanDelay, randomDelay } from "@/utils/delay.js";
import { extractArticleFromHtml } from "@/core/scraper/extractor.js";
import { extractLinkedInJobCompanyName } from "@/core/scraper/linkedinCompanyExtract.js";
import { extractLinkedInJobDescriptionPlainText } from "@/core/scraper/linkedinJobDescriptionExtract.js";
import { extractLinkedInJobTitle } from "@/core/scraper/linkedinJobTitleExtract.js";
import { parseLinkedInJobFields } from "@/core/scraper/linkedinJobFields.js";
import {
  extractLinkedInApplyUrlFromPage,
  extractLinkedInJobPagePlainText,
  normalizeLinkedInApplyUrl,
} from "@/core/scraper/linkedinPageTextExtract.js";
import { parseLinkedInJobWithOpenAi } from "@/core/scraper/openaiLinkedInJobExtract.js";
import { logger } from "@/utils/logger.js";
import {
  LINKEDIN_JOB_DETAIL_WAIT_MS,
  LINKEDIN_JOB_HYDRATE_WAIT_MS,
  LINKEDIN_JOB_PAGE_GOTO_MS,
} from "@/config/linkedinEasyApply.js";

/** LinkedIn a veces no dispara “load”; domcontentloaded + timeout explícito evita cuelgues. */
const NAV_TIMEOUT_MS = 90_000;
const JOB_LINKS_TIMEOUT_MS = 45_000;

export function jobIdFromUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 32);
}

const LOCATION_DETAIL_SELECTORS = [
  ".job-details-jobs-unified-top-card__bullet",
  ".jobs-unified-top-card__bullet",
  ".jobs-unified-top-card__workplace-type",
  linkedinPortal.selectors["jobLocation"] ?? "",
];

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
  /** Solo ofertas con candidatura en LinkedIn (parámetro f_AL en la búsqueda). */
  easyApplyOnly?: boolean;
}

/** Scroll sin depender de un contenedor concreto (el DOM de LinkedIn cambia a menudo). */
async function scrollJobSearchResults(page: Page, rounds = 10): Promise<void> {
  logger.info(`Desplazando la lista de resultados (${String(rounds)} pasadas)…`);
  for (let i = 0; i < rounds; i++) {
    await page.mouse.wheel(0, 1500);
    await humanDelay();
  }
}

async function waitForAnyJobViewLink(page: Page): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('a[href*="/jobs/view/"]').length > 0,
      { timeout: JOB_LINKS_TIMEOUT_MS },
    );
    return true;
  } catch {
    logger.warn(
      "No aparecieron enlaces a ofertas (/jobs/view/) a tiempo: sin resultados, captcha o UI distinta.",
    );
    return false;
  }
}

/** Recoge URLs únicas de ofertas visibles en la página de resultados. */
async function gatherJobViewLinks(page: Page, maxLinks: number): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  const anchors = page.locator('a[href*="/jobs/view/"]');
  const n = await anchors.count();
  for (let i = 0; i < n; i++) {
    if (out.length >= maxLinks) break;
    const href = await anchors.nth(i).getAttribute("href");
    if (!href) continue;
    const absolute = href.startsWith("http")
      ? href
      : `https://www.linkedin.com${href}`;
    const clean = (absolute.split("?")[0] ?? absolute).replace(/\/$/, "");
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function classifyInsightLine(line: string): "posted" | "applicants" | "other" {
  const lower = line.toLowerCase();
  if (
    /posted|publicad|hace\s+\d|^\d+\s*(day|día|hour|hora|min|week|sem|mes|month|year|año)/i.test(
      line,
    ) ||
    /\b(ago|today|yesterday|just now)\b/i.test(lower)
  ) {
    return "posted";
  }
  if (
    /applicant|postulante|aplicaron|people\s+(applied|clicked)|over\s+\d+|más\s+de|be\s+among\s+the/i.test(
      lower,
    )
  ) {
    return "applicants";
  }
  return "other";
}

async function collectInsightLines(page: Page): Promise<string[]> {
  const loc = page.locator(
    ".job-details-jobs-unified-top-card__job-insight, .jobs-unified-top-card__job-insight",
  );
  const n = await loc.count();
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    const raw = (await loc.nth(i).innerText()).trim();
    if (!raw) continue;
    for (const part of raw.split("\n")) {
      const t = part.trim();
      if (t) lines.push(t);
    }
  }
  return lines;
}

function splitPostedAndApplicants(lines: string[]): {
  postedLabel: string;
  applicantsLabel: string;
} {
  let postedLabel = "";
  let applicantsLabel = "";
  for (const line of lines) {
    const k = classifyInsightLine(line);
    if (k === "posted" && !postedLabel) postedLabel = line;
    if (k === "applicants" && !applicantsLabel) applicantsLabel = line;
  }
  return { postedLabel, applicantsLabel };
}

/** Espera a que la ficha del puesto pinte el área principal (React / UI nueva con clases hash). */
async function waitForJobDetailShell(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page
    .waitForFunction(
      () => {
        const topCard =
          document.querySelector(".jobs-unified-top-card") ||
          document.querySelector(".job-details-jobs-unified-top-card");
        if (topCard) return true;
        const applySel =
          "button.jobs-apply-button, button.jobs-apply-button--top-card, a.jobs-apply-button, a.jobs-apply-button--top-card, [class*='jobs-apply-button']";
        if (document.querySelectorAll(applySel).length > 0) return true;
        return (
          document.querySelector(
            ".jobs-description__content, .jobs-box__html-content, .jobs-search__job-details",
          ) !== null
        );
      },
      { timeout: LINKEDIN_JOB_DETAIL_WAIT_MS },
    )
    .catch(() => undefined);
  await new Promise((r) => setTimeout(r, 120));
}

/**
 * El shell (top card vacío o solo botón) aparece antes que título, empresa y descripción.
 * Sin esta espera, `Promise.all` lee el DOM demasiado pronto y todo queda vacío.
 */
async function waitForJobDetailHydrated(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const descSelectors =
          ".jobs-description__content, .jobs-box__html-content, .jobs-description";
        const desc = document.querySelector(descSelectors);
        if (desc) {
          const t = (desc.textContent || "").replace(/\s+/g, " ").trim();
          if (t.length > 35) return true;
        }
        const broad = document.querySelectorAll("[class*='jobs-description']");
        for (let i = 0; i < broad.length; i++) {
          const t = (broad[i].textContent || "").replace(/\s+/g, " ").trim();
          if (t.length > 40) return true;
        }
        const card =
          document.querySelector(".jobs-unified-top-card") ||
          document.querySelector(".job-details-jobs-unified-top-card");
        if (!card) return false;
        const cardText = (card.textContent || "").replace(/\s+/g, " ").trim();
        if (cardText.length < 90) return false;
        if (
          document.querySelector("[aria-label*='Empresa,'], [aria-label*='Company,']") !== null
        ) {
          return true;
        }
        if (card.querySelector('a[href*="/company/"]') !== null && cardText.length > 120) {
          return true;
        }
        return false;
      },
      { timeout: LINKEDIN_JOB_HYDRATE_WAIT_MS },
    )
    .catch(() => undefined);
}

function isExternalApplyControl(aria: string, className: string, innerText: string): boolean {
  const c = className.toLowerCase();
  if (c.includes("external")) return true;
  const blob = `${aria} ${innerText}`.toLowerCase();
  if (
    /company'?s?\s+site|company website|sitio web de la empresa|apply on company website/i.test(
      blob,
    )
  ) {
    return true;
  }
  if (aria.toLowerCase().includes("external")) return true;
  return false;
}

/**
 * LinkedIn usa a menudo `<a class="jobs-apply-button">` (no `<button>`) para "Solicitud sencilla".
 * Esta comprobación inspecciona el DOM en el navegador.
 */
async function detectEasyApplyInBrowserDom(page: Page): Promise<boolean> {
  // Sin funciones anidadas: tsx/ts emiten __name en el bundle y falla en el contexto del navegador.
  return page.evaluate(() => {
    const markers =
      /solicitud\s+sencilla|easy\s+apply|postular\s+con\s+linkedin|candidatura\s+sencilla/i;
    const sel =
      "button.jobs-apply-button, button.jobs-apply-button--top-card, a.jobs-apply-button, a.jobs-apply-button--top-card, [class*='jobs-apply-button']";
    const nodes = Array.from(document.querySelectorAll(sel));
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i] as HTMLElement;
      const cls = el.className?.toString() ?? "";
      if (cls.includes("external")) continue;
      const aria = el.getAttribute("aria-label") ?? "";
      const fullText = (el.textContent ?? el.innerText ?? "").trim();
      const blob = `${aria} ${fullText}`.toLowerCase();
      if (
        /company'?s?\s+site|company website|sitio web de la empresa|apply on company website/i.test(
          blob,
        )
      ) {
        continue;
      }
      if (aria.toLowerCase().includes("external")) continue;
      const normalized = `${fullText} ${aria}`
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!markers.test(normalized)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const st = window.getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) {
        continue;
      }
      return true;
    }
    return false;
  });
}

/**
 * Detecta candidatura sencilla (Easy Apply en LinkedIn).
 * La UI cambia y el botón a veces tarda; por eso primero esperamos el shell.
 */
export async function hasEasyApplyOnPage(page: Page): Promise<boolean> {
  await waitForJobDetailShell(page);

  if (await detectEasyApplyInBrowserDom(page)) return true;

  const applyLike = page.locator(
    "button.jobs-apply-button--top-card, button.jobs-apply-button, a.jobs-apply-button--top-card, a.jobs-apply-button, [class*='jobs-apply-button']",
  );
  const n = await applyLike.count();
  for (let i = 0; i < n; i++) {
    const el = applyLike.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const aria = (await el.getAttribute("aria-label")) ?? "";
    const cls = (await el.getAttribute("class")) ?? "";
    const text = (await el.innerText().catch(() => "")) ?? "";
    if (isExternalApplyControl(aria, cls, text)) continue;
    if (
      /Easy Apply|Solicitud sencilla|Postular con LinkedIn|Candidatura sencilla/i.test(
        `${text} ${aria}`,
      )
    ) {
      return true;
    }
  }

  /** No usar `page.locator("button, a").filter(hasText:…)` en toda la página: LinkedIn tiene miles de nodos y tarda decenas de segundos. */
  const scopedCard = page
    .locator(".jobs-unified-top-card, .job-details-jobs-unified-top-card")
    .first();
  const byTextScoped = scopedCard
    .locator("button, a")
    .filter({
      hasText: /Easy Apply|Solicitud sencilla|Postular con LinkedIn|Candidatura sencilla/i,
    });
  const nScoped = await byTextScoped.count();
  for (let i = 0; i < nScoped; i++) {
    const el = byTextScoped.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const aria = (await el.getAttribute("aria-label")) ?? "";
    const cls = (await el.getAttribute("class")) ?? "";
    const text = (await el.innerText().catch(() => "")) ?? "";
    if (isExternalApplyControl(aria, cls, text)) continue;
    return true;
  }

  const rolePatterns = [
    /easy apply/i,
    /solicitud sencilla/i,
    /postular con linkedin/i,
    /candidatura sencilla/i,
  ];
  for (const re of rolePatterns) {
    const loc = page.getByRole("button", { name: re }).first();
    if ((await loc.count()) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    const aria = (await loc.getAttribute("aria-label")) ?? "";
    const cls = (await loc.getAttribute("class")) ?? "";
    const text = (await loc.innerText().catch(() => "")) ?? "";
    if (isExternalApplyControl(aria, cls, text)) continue;
    return true;
  }

  for (const re of rolePatterns) {
    const loc = page.getByRole("link", { name: re }).first();
    if ((await loc.count()) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    const aria = (await loc.getAttribute("aria-label")) ?? "";
    const cls = (await loc.getAttribute("class")) ?? "";
    const text = (await loc.innerText().catch(() => "")) ?? "";
    if (isExternalApplyControl(aria, cls, text)) continue;
    return true;
  }

  return false;
}

export interface CollectLinkedInEasyApplyOptions {
  query: string;
  location: string;
  maxJobs: number;
}

async function collectJobListingSnapshotFromPage(
  page: Page,
  jobUrl: string,
  options: CollectLinkedInEasyApplyOptions,
  easyApplyVerifiedOnPage: boolean,
): Promise<Omit<JobListingSnapshot, "id" | "scrapedAt" | "easyApply">> {
  const applyFromDom = await extractLinkedInApplyUrlFromPage(page);

  if (env.useOpenAiCollectParse && env.OPENAI_API_KEY) {
    let pageText = await extractLinkedInJobPagePlainText(page);
    if (pageText.length < 120) {
      try {
        const html = await page.content();
        const article = extractArticleFromHtml(html);
        const t = article?.textContent?.trim() ?? "";
        if (t.length > pageText.length) pageText = t;
      } catch {
        /* ignore */
      }
    }
    const { fields: ai, usage } = await parseLinkedInJobWithOpenAi({
      apiKey: env.OPENAI_API_KEY,
      model: env.COLLECT_OPENAI_MODEL,
      pageText,
      jobViewUrl: jobUrl,
    });
    const applyUrl =
      normalizeLinkedInApplyUrl(ai.applyUrl) || applyFromDom || jobUrl;
    return {
      title: ai.title.trim() || "Sin título",
      company: ai.company.trim() || "Empresa desconocida",
      location: ai.location.trim() || options.location,
      country: ai.country.trim(),
      requirements: ai.requirements.trim(),
      applicantsLabel: ai.applicantsLabel.trim(),
      postedLabel: ai.postedLabel.trim(),
      url: jobUrl,
      applyUrl,
      easyApplyVerifiedOnPage,
      ...(usage
        ? {
            openAiTokenUsage: {
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
            },
          }
        : {}),
    };
  }

  const [titleDom, companyDom, locationDom, insightLines, rawFromDom] = await Promise.all([
    extractLinkedInJobTitle(page),
    extractLinkedInJobCompanyName(page),
    pickFirstText(page, LOCATION_DETAIL_SELECTORS),
    collectInsightLines(page),
    extractLinkedInJobDescriptionPlainText(page),
  ]);

  let rawFull = rawFromDom;
  if (!rawFull.trim()) {
    rawFull = await pickFirstText(page, [linkedinPortal.selectors["jobDescription"] ?? ""]);
  }
  if (!rawFull.trim()) {
    try {
      const html = await page.content();
      const article = extractArticleFromHtml(html);
      rawFull = article?.textContent?.trim() ?? "";
    } catch {
      rawFull = "";
    }
  }

  const parsed = parseLinkedInJobFields(rawFull);
  const fromInsights = splitPostedAndApplicants(insightLines);

  const title = (titleDom || parsed.title || "Sin título").trim();
  const company = (companyDom.trim() || "Empresa desconocida").trim();
  const locationText = (locationDom || parsed.locationLine || options.location).trim();
  const applicantsLabel =
    fromInsights.applicantsLabel || parsed.applicantsLabel;
  const postedLabel = fromInsights.postedLabel || parsed.postedLabel;
  const requirements = (parsed.aboutJob || "").trim();

  return {
    title,
    company,
    location: locationText,
    country: "",
    requirements,
    applicantsLabel,
    postedLabel,
    url: jobUrl,
    applyUrl: applyFromDom || jobUrl,
    easyApplyVerifiedOnPage,
  };
}

export async function collectLinkedInEasyApplyJobs(
  page: Page,
  options: CollectLinkedInEasyApplyOptions,
): Promise<JobListingSnapshot[]> {
  const results: JobListingSnapshot[] = [];
  const url = linkedinPortal.searchUrl(options.query, options.location, {
    easyApplyOnly: true,
  });
  logger.info(`Abriendo búsqueda: ${url}`);
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: NAV_TIMEOUT_MS,
  });
  await randomDelay();
  await page.waitForLoadState("load", { timeout: 35_000 }).catch(() => {
    logger.info("Evento load tardío; se sigue cuando aparezcan enlaces de ofertas.");
  });

  if (page.url().includes("login") || page.url().includes("checkpoint")) {
    throw new Error(
      "LinkedIn requiere inicio de sesión. Ejecuta `pnpm cli -- login` y guarda la sesión.",
    );
  }

  const hasLinks = await waitForAnyJobViewLink(page);
  if (!hasLinks) {
    return results;
  }

  await scrollJobSearchResults(page);

  const linkBudget = Math.max(options.maxJobs * 4, 20);
  let jobLinks = await gatherJobViewLinks(page, linkBudget);
  logger.info(`Enlaces de ofertas detectados: ${String(jobLinks.length)}`);

  if (jobLinks.length === 0) {
    const cardSelector = linkedinPortal.selectors["jobCard"];
    const cards = await page.locator(cardSelector).all();
    for (const card of cards) {
      if (jobLinks.length >= linkBudget) break;
      const link = card.locator('a[href*="/jobs/view/"]').first();
      if ((await link.count()) === 0) continue;
      const href = await link.getAttribute("href");
      if (!href) continue;
      const absolute = href.startsWith("http")
        ? href
        : `https://www.linkedin.com${href}`;
      const clean = (absolute.split("?")[0] ?? absolute).replace(/\/$/, "");
      if (!jobLinks.includes(clean)) jobLinks.push(clean);
    }
    logger.info(`Enlaces (fallback por tarjetas): ${String(jobLinks.length)}`);
  }

  if (env.useOpenAiCollectParse && env.OPENAI_API_KEY) {
    logger.info(`Collect: campos estructurados con OpenAI (${env.COLLECT_OPENAI_MODEL}).`);
  }

  for (let idx = 0; idx < jobLinks.length; idx++) {
    const jobUrl = jobLinks[idx];
    if (results.length >= options.maxJobs) break;
    try {
      logger.info(
        `Abriendo ficha ${String(idx + 1)}/${String(jobLinks.length)} (objetivo ${String(options.maxJobs)} guardados)…`,
      );
      await page.goto(jobUrl, {
        waitUntil: "domcontentloaded",
        timeout: LINKEDIN_JOB_PAGE_GOTO_MS,
      });

      const easyApplyVerifiedOnPage = await hasEasyApplyOnPage(page);
      if (!easyApplyVerifiedOnPage && env.COLLECT_REQUIRE_EASY_APPLY_BUTTON) {
        logger.info(`Omitido (sin Easy Apply en ficha): ${jobUrl}`);
        continue;
      }
      if (!easyApplyVerifiedOnPage && !env.COLLECT_REQUIRE_EASY_APPLY_BUTTON) {
        logger.info(
          `Guardando con filtro f_AL (botón no detectado en UI; revisa la ficha): ${jobUrl}`,
        );
      }

      await waitForJobDetailHydrated(page);

      const snapshot = await collectJobListingSnapshotFromPage(
        page,
        jobUrl,
        options,
        easyApplyVerifiedOnPage,
      );
      const id = jobIdFromUrl(jobUrl);
      results.push({
        id,
        ...snapshot,
        easyApply: true,
        scrapedAt: new Date().toISOString(),
      });
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      logger.warn(`No se pudo extraer el empleo ${jobUrl}: ${err.message}`);
    }
  }

  return results;
}

export async function scrapeLinkedInJobList(
  page: Page,
  options: ScrapeLinkedInJobsOptions,
): Promise<JobPost[]> {
  const results: JobPost[] = [];
  try {
    const url = linkedinPortal.searchUrl(options.query, options.location, {
      easyApplyOnly: options.easyApplyOnly,
    });
    logger.info(`Búsqueda de empleos: ${url}`);
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    await randomDelay();
    await page.waitForLoadState("load", { timeout: 35_000 }).catch(() => {
      logger.info("Evento load tardío; esperando enlaces de ofertas…");
    });

    if (page.url().includes("login") || page.url().includes("checkpoint")) {
      throw new Error(
        "LinkedIn requiere inicio de sesión. Ejecuta `pnpm cli -- login` y guarda la sesión.",
      );
    }

    const hasLinks = await waitForAnyJobViewLink(page);
    if (!hasLinks) {
      return results;
    }

    await scrollJobSearchResults(page);

    const linkBudget = Math.max(options.maxJobs * 3, 15);
    let jobLinks = await gatherJobViewLinks(page, linkBudget);

    if (jobLinks.length === 0) {
      const cardSelector = linkedinPortal.selectors["jobCard"];
      const cards = await page.locator(cardSelector).all();
      for (const card of cards) {
        if (jobLinks.length >= linkBudget) break;
        const link = card.locator('a[href*="/jobs/view/"]').first();
        if ((await link.count()) === 0) continue;
        const href = await link.getAttribute("href");
        if (!href) continue;
        const absolute = href.startsWith("http")
          ? href
          : `https://www.linkedin.com${href}`;
        const clean = (absolute.split("?")[0] ?? absolute).replace(/\/$/, "");
        if (!jobLinks.includes(clean)) jobLinks.push(clean);
      }
    }

    for (const jobUrl of jobLinks) {
      if (results.length >= options.maxJobs) break;
      try {
        await page.goto(jobUrl, {
          waitUntil: "domcontentloaded",
          timeout: LINKEDIN_JOB_PAGE_GOTO_MS,
        });

        await waitForJobDetailHydrated(page);

        const [title, company, location, descriptionRaw] = await Promise.all([
          extractLinkedInJobTitle(page),
          extractLinkedInJobCompanyName(page),
          pickFirstText(page, [
            ".job-details-jobs-unified-top-card__bullet",
            linkedinPortal.selectors["jobLocation"] ?? "",
          ]),
          extractLinkedInJobDescriptionPlainText(page),
        ]);
        let description = descriptionRaw;
        if (!description.trim()) {
          description = await pickFirstText(page, [
            linkedinPortal.selectors["jobDescription"] ?? "",
          ]);
        }
        if (!description.trim()) {
          try {
            const html = await page.content();
            const article = extractArticleFromHtml(html);
            description = article?.textContent?.trim() ?? "";
          } catch {
            description = "";
          }
        }

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
