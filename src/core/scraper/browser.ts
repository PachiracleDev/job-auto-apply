import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
} from "playwright-core";

/** Estado serializable (cookies + origins), sin ruta a archivo. */
export type InMemoryStorageState = Exclude<
  BrowserContextOptions["storageState"],
  string | undefined
>;
import { env } from "@/config/env.js";
import { logger } from "@/utils/logger.js";

/**
 * Mitigación mínima: LinkedIn detecta `navigator.webdriver`.
 * Evitamos parches agresivos (`plugins` falsos, `chrome` fake) que empeoran el riesgo.
 */
const MINIMAL_STEALTH = `
(() => {
  try {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  } catch (_) {}
})();
`;

export interface LaunchBrowserOptions {
  headless?: boolean;
  /** Ruta a JSON de `storageState` en disco. */
  storageStatePath?: string;
  /** Estado en memoria (cookies + origins). Tiene prioridad sobre `storageStatePath`. */
  storageState?: InMemoryStorageState;
  /**
   * Solo para `login`: perfil Chrome persistente (más parecido a un navegador “normal”;
   * LinkedIn suele rechazar ventanas con perfil efímero).
   */
  persistentProfile?: boolean;
}

export interface LaunchBrowserResult {
  browser: Browser | null;
  context: BrowserContext;
}

function commonLaunchOptions(headless: boolean) {
  const exec = env.BROWSER_PATH?.trim();
  const args: string[] = [
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    "--window-size=1280,900",
  ];
  if (process.platform !== "win32") {
    args.push("--no-sandbox");
  }
  return {
    headless,
    args,
    ...(exec ? { executablePath: exec } : { channel: "chrome" as const }),
    // Menos bandera “automation” explícita (Chrome estable)
    ignoreDefaultArgs: ["--enable-automation"],
  };
}

export async function launchBrowser(
  options: LaunchBrowserOptions = {},
): Promise<LaunchBrowserResult> {
  try {
    const headless = options.headless ?? false;
    const wsEndpoint = env.PLAYWRIGHT_WS_ENDPOINT?.trim();

    if (wsEndpoint) {
      if (options.persistentProfile) {
        throw new Error(
          "PLAYWRIGHT_WS_ENDPOINT activo: no se puede usar perfil persistente local. " +
            "Inicia sesión con storageState o desactiva el endpoint remoto.",
        );
      }
      logger.info("launchBrowser: conectando a Playwright remoto (WebSocket)");
      const browser = await chromium.connect(wsEndpoint, { timeout: 120_000 });
      const storageState =
        options.storageState ?? options.storageStatePath ?? undefined;
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        ...(storageState !== undefined ? { storageState } : {}),
      });
      await context.addInitScript(MINIMAL_STEALTH);
      return { browser, context };
    }

    const base = commonLaunchOptions(headless);
    const usePersistent =
      Boolean(options.persistentProfile) &&
      !options.storageStatePath &&
      !options.storageState &&
      !headless;

    if (usePersistent) {
      const userDataDir = join(env.dataDirAbs, "pw-chrome-profile");
      mkdirSync(userDataDir, { recursive: true });

      const context = await chromium.launchPersistentContext(userDataDir, {
        ...base,
        viewport: { width: 1280, height: 900 },
        // Sin UA/locale/tz forzados: que coincidan con tu Chrome instalado
      });
      await context.addInitScript(MINIMAL_STEALTH);
      const browser = context.browser();
      return { browser, context };
    }

    const browser = await chromium.launch(base);
    const storageState =
      options.storageState ?? options.storageStatePath ?? undefined;
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      ...(storageState !== undefined ? { storageState } : {}),
    });
    await context.addInitScript(MINIMAL_STEALTH);
    return { browser, context };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error("launchBrowser: " + err.message);
    if (!env.BROWSER_PATH?.trim()) {
      throw new Error(
        `${err.message}\n` +
          "Si sigue fallando, define BROWSER_PATH en .env con la ruta a chrome.exe " +
          "(p. ej. C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe).",
      );
    }
    throw err;
  }
}
