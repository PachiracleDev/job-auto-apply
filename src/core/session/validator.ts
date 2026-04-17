import type { BrowserContext, Page } from "playwright-core";
import { humanDelay, randomDelay } from "@/utils/delay.js";
import { logger } from "@/utils/logger.js";

const FEED_PATH = "/feed";

export async function validateLinkedInSession(
  context: BrowserContext,
): Promise<boolean> {
  let page: Page | undefined;
  try {
    page = await context.newPage();
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
    });
    await randomDelay();
    const url = page.url();
    if (url.includes("login") || url.includes("checkpoint")) {
      logger.warn("Sesión inválida o expirada (redirección a login/checkpoint).");
      return false;
    }
    if (!url.includes(FEED_PATH) && !url.includes("linkedin.com")) {
      logger.warn("URL inesperada tras abrir feed: " + url);
      return false;
    }
    await humanDelay();
    return true;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error("validateLinkedInSession: " + err.message);
    return false;
  } finally {
    if (page) {
      await page.close().catch(() => undefined);
    }
  }
}
