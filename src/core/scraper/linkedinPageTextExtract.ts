import type { Page } from "playwright-core";

const MAX_CHARS = 32_000;

/**
 * Texto visible de la zona de detalle del empleo (sin serializar todo el HTML).
 * Sirve como entrada para un modelo que estructura empresa, título, etc.
 */
export async function extractLinkedInJobPagePlainText(page: Page): Promise<string> {
  const text = await page.evaluate(() => {
    const candidates: (Element | null)[] = [
      document.querySelector(".jobs-search__job-details"),
      document.querySelector(".jobs-details__main"),
      document.querySelector(".scaffold-layout__detail"),
      document.querySelector("main"),
      document.body,
    ];
    const root = candidates.find((n) => n !== null);
    if (!root) return "";
    const raw = (root as HTMLElement).innerText || "";
    return raw.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  });
  if (text.length <= MAX_CHARS) return text;
  return `${text.slice(0, MAX_CHARS)}\n…`;
}

function absolutizeLinkedInHref(href: string): string {
  const h = href.trim();
  if (!h) return "";
  if (h.startsWith("http")) return h.split("?")[0]?.replace(/\/$/, "") ?? h;
  if (h.startsWith("/")) return `https://www.linkedin.com${h.split("?")[0]}`;
  return "";
}

/** Normaliza URL de candidatura devuelta por el modelo (o cadena vacía). */
export function normalizeLinkedInApplyUrl(raw: string): string {
  return absolutizeLinkedInHref(raw);
}

/** Enlace a candidatura Easy Apply si existe en el DOM. */
export async function extractLinkedInApplyUrlFromPage(page: Page): Promise<string> {
  const href = await page.evaluate(() => {
    const nodes = document.querySelectorAll(
      'a[href*="/apply/"], a[href*="openSDUIApplyFlow"], a[aria-label*="Solicitud sencilla"], a[aria-label*="Easy Apply"]',
    );
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i] as HTMLAnchorElement;
      const h = a.getAttribute("href") || "";
      if (!h.includes("/apply") && !h.includes("openSDUIApplyFlow")) continue;
      if (/external|company.?site/i.test(`${a.getAttribute("aria-label")} ${a.className}`)) {
        continue;
      }
      return h;
    }
    return "";
  });
  return absolutizeLinkedInHref(href);
}
