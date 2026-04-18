import type { Page } from "playwright-core";
import { LINKEDIN_JOB_DETAIL_WAIT_MS } from "@/config/linkedinEasyApply.js";

const TOP_CARD = ".jobs-unified-top-card, .job-details-jobs-unified-top-card";

/** Selectores legacy cuando LinkedIn expone clases en la tarjeta superior. */
const LEGACY_TITLE_SELECTORS: string[] = [
  ".job-details-jobs-unified-top-card__job-title",
  ".jobs-unified-top-card__job-title h1",
  ".jobs-unified-top-card__job-title",
  ".jobs-details-top-card__job-title",
  "h1.job-title",
];

function looksLikeLocationOrMetaLine(t: string): boolean {
  const s = t.trim();
  if (!s) return true;
  if (/\s·\s/.test(s)) return true;
  if (/solicitudes|applicants|people\s+clicked/i.test(s)) return true;
  if (/hace\s+\d+\s+(?:segundo|minuto|hora|día|semana|mes)/i.test(s)) return true;
  if (/\bago\b|posted|publicad/i.test(s)) return true;
  if (/^Promocionado\b/i.test(s)) return true;
  return false;
}

function looksLikeJobTitle(t: string): boolean {
  const s = t.replace(/\s+/g, " ").trim();
  if (s.length < 2 || s.length > 220) return false;
  if (looksLikeLocationOrMetaLine(s)) return false;
  if (/^Acerca del empleo/i.test(s)) return false;
  return true;
}

/**
 * Título en la cabecera de la ficha (a veces `<h1>`, a veces solo `<p>` tras el bloque empresa).
 */
export async function extractLinkedInJobTitle(page: Page): Promise<string> {
  await page
    .locator(TOP_CARD)
    .first()
    .waitFor({ state: "visible", timeout: LINKEDIN_JOB_DETAIL_WAIT_MS })
    .catch(() => undefined);

  const card = page.locator(TOP_CARD).first();

  for (const sel of LEGACY_TITLE_SELECTORS) {
    const loc = card.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    const t = (await loc.innerText().catch(() => "")).trim();
    if (looksLikeJobTitle(t)) return t;
  }

  const h1 = card.locator("h1").first();
  if ((await h1.count()) > 0) {
    const t = (await h1.innerText().catch(() => "")).trim();
    if (looksLikeJobTitle(t)) return t;
  }

  const fromDom = await page.evaluate(() => {
    const root =
      document.querySelector(".jobs-unified-top-card") ||
      document.querySelector(".job-details-jobs-unified-top-card");
    if (!root) return "";

    const legacy = root.querySelector(
      ".job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, .jobs-details-top-card__job-title",
    );
    if (legacy) {
      const t = (legacy.textContent || "").replace(/\s+/g, " ").trim();
      if (t.length >= 2 && t.length < 220) return t;
    }

    const h1El = root.querySelector("h1");
    if (h1El) {
      const t = (h1El.textContent || "").replace(/\s+/g, " ").trim();
      if (t.length >= 2 && t.length < 220 && !/\s·\s/.test(t)) return t;
    }

    const ps = root.querySelectorAll("p");
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.closest('a[href*="/company/"]')) continue;
      const t = (p.textContent || "").replace(/\s+/g, " ").trim();
      if (t.length < 2 || t.length > 220) continue;
      if (/\s·\s/.test(t)) continue;
      if (/solicitudes|hace\s+\d|Promocionado|Acerca del empleo/i.test(t)) continue;
      return t;
    }
    return "";
  });

  return (fromDom || "").trim();
}
