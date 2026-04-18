import { mkdirSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BrowserContext } from "playwright-core";
import { env } from "@/config/env.js";
import { logger } from "@/utils/logger.js";

export function getLinkedInSessionPath(): string {
  return join(env.dataDirAbs, "session", "linkedin", "state.json");
}

export function ensureSessionDir(): void {
  const dir = dirname(getLinkedInSessionPath());
  mkdirSync(dir, { recursive: true });
}

export function sessionFileExists(): boolean {
  return existsSync(getLinkedInSessionPath());
}

export async function saveSession(context: BrowserContext): Promise<void> {
  try {
    ensureSessionDir();
    const path = getLinkedInSessionPath();
    await context.storageState({ path });
    logger.info("Sesión guardada en " + path);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error("saveSession: " + err.message);
    throw err;
  }
}

export function loadStorageState(): { cookies: unknown[]; origins?: unknown[] } {
  try {
    const path = getLinkedInSessionPath();
    if (!existsSync(path)) {
      throw new Error("No hay sesión guardada. Ejecuta `pnpm cli -- login` primero.");
    }
    const raw = readFileSync(path, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("cookies" in parsed) ||
      !Array.isArray((parsed as { cookies: unknown }).cookies)
    ) {
      throw new Error("Archivo de sesión inválido");
    }
    return parsed as { cookies: unknown[]; origins?: unknown[] };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error("loadStorageState: " + err.message);
    throw err;
  }
}

export function clearSessionFile(): void {
  try {
    const path = getLinkedInSessionPath();
    if (existsSync(path)) {
      unlinkSync(path);
      logger.info("Sesión eliminada: " + path);
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error("clearSessionFile: " + err.message);
    throw err;
  }
}
