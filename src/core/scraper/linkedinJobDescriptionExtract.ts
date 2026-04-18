import type { Page } from "playwright-core";

const DESCRIPTION_SELECTORS = [
  ".jobs-description__content",
  ".jobs-box__html-content",
  ".jobs-description",
  ".jobs-search__job-details .jobs-description-content",
];

/**
 * Texto de la descripción del puesto sin serializar todo el HTML (evita ~segundos y MB en `page.content()`).
 */
export async function extractLinkedInJobDescriptionPlainText(page: Page): Promise<string> {
  const fromEval = await page.evaluate(() => {
    const sels = [
      ".jobs-description__content",
      ".jobs-box__html-content",
      ".jobs-description",
    ];
    for (let i = 0; i < sels.length; i++) {
      const el = document.querySelector(sels[i]);
      if (el) {
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (t.length > 20) return t;
      }
    }
    const broad = document.querySelectorAll("[class*='jobs-description']");
    for (let j = 0; j < broad.length; j++) {
      const t = (broad[j].textContent || "").replace(/\s+/g, " ").trim();
      if (t.length > 25) return t;
    }
    return "";
  });
  if (fromEval.length > 20) return fromEval;

  for (const sel of DESCRIPTION_SELECTORS) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    const t = (await loc.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (t.length > 20) return t;
  }
  return "";
}
