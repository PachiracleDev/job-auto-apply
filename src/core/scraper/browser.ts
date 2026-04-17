import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { env } from "@/config/env.js";
import { logger } from "@/utils/logger.js";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const STEALTH_INIT = `
(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['es-PE', 'es', 'en-US', 'en'] });
  window.chrome = { runtime: {} };
})();
`;

export interface LaunchBrowserOptions {
  headless?: boolean;
  storageStatePath?: string;
}

export async function launchBrowser(
  options: LaunchBrowserOptions = {},
): Promise<{ browser: Browser; context: BrowserContext }> {
  try {
    const headless = options.headless ?? false;
    const launchOpts = {
      headless,
      args: [
        "--no-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--window-size=1280,900",
      ],
      executablePath: env.BROWSER_PATH || undefined,
    };

    let browser: Browser;
    if (launchOpts.executablePath) {
      browser = await chromium.launch(launchOpts);
    } else {
      try {
        browser = await chromium.launch({
          ...launchOpts,
          channel: "chrome",
        });
      } catch (e1) {
        const a = e1 instanceof Error ? e1.message : String(e1);
        throw new Error(
          "No se pudo iniciar Chrome (channel=chrome). Instala Google Chrome o define BROWSER_PATH al ejecutable de Chromium/Chrome.\n" +
            `Detalle: ${a}`,
        );
      }
    }

    const context = await browser.newContext({
      userAgent: CHROME_UA,
      viewport: { width: 1280, height: 900 },
      locale: "es-PE",
      timezoneId: "America/Lima",
      storageState: options.storageStatePath,
    });

    await context.addInitScript(STEALTH_INIT);

    return { browser, context };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error("launchBrowser: " + err.message);
    throw err;
  }
}
