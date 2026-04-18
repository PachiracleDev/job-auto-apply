import type { Page } from "playwright-core";
import { LINKEDIN_JOB_DETAIL_WAIT_MS } from "@/config/linkedinEasyApply.js";

/** Selectores legacy (cuando LinkedIn aún expone clases estables). */
const LEGACY_COMPANY_SELECTORS: string[] = [
  ".job-details-jobs-unified-top-card__company-name a",
  ".job-details-jobs-unified-top-card__company-name",
  ".jobs-unified-top-card__company-name a",
  ".jobs-unified-top-card__company-name",
  ".jobs-details-top-card__company-name a",
  ".jobs-details-top-card__company-name",
  ".jobs-unified-top-card__subtitle-primary-grouping a",
  "a.job-details-jobs-unified-top-card__company-name",
  ".job-details-jobs-unified-top-card .artdeco-entity-lockup__subtitle",
  ".jobs-unified-top-card .artdeco-entity-lockup__subtitle",
];

function looksLikeCompanyName(s: string): boolean {
  const t = s.trim();
  if (t.length < 2 || t.length > 180) return false;
  if (/^(ver|see|linkedin|inicio|home|apply)\s/i.test(t)) return false;
  if (t.includes("linkedin.com")) return false;
  return true;
}

function parseEmpresaAriaLabel(aria: string | null): string {
  if (!aria) return "";
  let m = aria.match(/^Empresa,\s*(.+)$/i);
  if (m) return m[1].trim();
  m = aria.match(/^Company,\s*(.+)$/i);
  if (m) return m[1].trim();
  return "";
}

function parseLogoAlt(alt: string | null): string {
  if (!alt) return "";
  let m = alt.match(/Logotipo de empresa para\s+(.+)/i);
  if (m) return m[1].trim();
  m = alt.match(/Company logo for\s+(.+)/i);
  if (m) return m[1].trim();
  return "";
}

/**
 * Cabecera actual de LinkedIn: `aria-label="Empresa, Nombre"`, enlaces a `/company/slug/life/`,
 * texto en `<a>` anidado y `alt` del logotipo.
 */
export async function extractLinkedInJobCompanyName(page: Page): Promise<string> {
  await page
    .locator(".jobs-unified-top-card, .job-details-jobs-unified-top-card")
    .first()
    .waitFor({ state: "visible", timeout: LINKEDIN_JOB_DETAIL_WAIT_MS })
    .catch(() => undefined);

  const card = page.locator(".jobs-unified-top-card, .job-details-jobs-unified-top-card").first();

  // 1) aria-label "Empresa, …" / "Company, …" (bloque cabecera)
  const ariaNodes = card.locator("[aria-label*='Empresa,'], [aria-label*='Company,']");
  const ariaCount = await ariaNodes.count();
  for (let i = 0; i < ariaCount; i++) {
    const al = await ariaNodes.nth(i).getAttribute("aria-label");
    const name = parseEmpresaAriaLabel(al);
    if (looksLikeCompanyName(name)) return name;
  }

  // 2) Imagen de logotipo con alt "Logotipo de empresa para X"
  const imgLogo = card.locator(
    'img[alt*="Logotipo de empresa para"], img[alt*="Company logo for"]',
  );
  if ((await imgLogo.count()) > 0) {
    const alt = await imgLogo.first().getAttribute("alt");
    const name = parseLogoAlt(alt);
    if (looksLikeCompanyName(name)) return name;
  }

  // 3) Enlace a página de empresa (no /jobs/), texto suele estar en anidado <a>
  const companyLinks = card.locator(
    'a[href*="/company/"]:not([href*="/jobs/"]):not([href*="jobPosting"])',
  );
  const nLinks = await companyLinks.count();
  for (let i = 0; i < nLinks; i++) {
    const link = companyLinks.nth(i);
    const inner = link.locator('a[href*="/company/"]').first();
    let text = "";
    if ((await inner.count()) > 0) {
      text = (await inner.innerText().catch(() => "")).trim();
    }
    if (!text) text = (await link.innerText().catch(() => "")).trim();
    if (looksLikeCompanyName(text)) return text;
  }

  // 4) Legacy class names
  for (const sel of LEGACY_COMPANY_SELECTORS) {
    try {
      const loc = page.locator(sel).first();
      if ((await loc.count()) === 0) continue;
      const text = (await loc.innerText().catch(() => "")).trim();
      if (looksLikeCompanyName(text)) return text;
    } catch {
      continue;
    }
  }

  // 5) Recorrido en el navegador (DOM obfuscado con clases hash)
  const fromDom = await page.evaluate(() => {
    const root =
      document.querySelector(".jobs-unified-top-card") ||
      document.querySelector(".job-details-jobs-unified-top-card");
    if (!root) return "";

    const els = root.querySelectorAll("[aria-label]");
    for (let i = 0; i < els.length; i++) {
      const al = els[i].getAttribute("aria-label") || "";
      let m = al.match(/^Empresa,\s*(.+)$/i);
      if (m) return m[1].trim();
      m = al.match(/^Company,\s*(.+)$/i);
      if (m) return m[1].trim();
    }

    const imgs = root.querySelectorAll("img");
    for (let i = 0; i < imgs.length; i++) {
      const alt = imgs[i].getAttribute("alt") || "";
      let m = alt.match(/Logotipo de empresa para\s+(.+)/i);
      if (m) return m[1].trim();
      m = alt.match(/Company logo for\s+(.+)/i);
      if (m) return m[1].trim();
    }

    const links = root.querySelectorAll('a[href*="/company/"]');
    for (let i = 0; i < links.length; i++) {
      const a = links[i];
      const href = a.getAttribute("href") || "";
      if (href.includes("/jobs/") || href.includes("jobPosting")) continue;
      if (!/\/company\/[^/]+/.test(href)) continue;
      const nested = a.querySelector('a[href*="/company/"]');
      const node = nested || a;
      const t = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (t.length > 1 && t.length < 180) return t;
    }
    return "";
  });

  return (fromDom || "").trim();
}
