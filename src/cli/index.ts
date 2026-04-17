#!/usr/bin/env node
import { Command } from "commander";
import { intro, outro } from "@clack/prompts";
import { env } from "@/config/env.js";
import { launchBrowser } from "@/core/scraper/browser.js";
import {
  clearSessionFile,
  ensureSessionDir,
  getLinkedInSessionPath,
  saveSession,
  sessionFileExists,
} from "@/core/session/manager.js";
import { validateLinkedInSession } from "@/core/session/validator.js";
import { runApplicationPipeline } from "@/core/applicator/index.js";
import { listTrackedApplications } from "@/core/tracker/index.js";
import { initDataLayer } from "@/data/db.js";
import { logger } from "@/utils/logger.js";

async function cmdLogin(): Promise<void> {
  try {
    intro("Inicio de sesión LinkedIn");
    ensureSessionDir();
    const { browser, context } = await launchBrowser({ headless: false });
    const page = await context.newPage();
    await page.goto("https://www.linkedin.com/login", {
      waitUntil: "domcontentloaded",
    });
    logger.info(
      "Completa el inicio de sesión en el navegador. Esperando redirección a /feed/ …",
    );
    await page.waitForURL(/linkedin\.com\/feed/, { timeout: 600_000 });
    await saveSession(context);
    await context.close();
    await browser.close();
    outro("Sesión guardada correctamente.");
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error("login: " + err.message);
    throw err;
  }
}

async function cmdCheckSession(): Promise<void> {
  try {
    if (!sessionFileExists()) {
      logger.warn("No hay archivo de sesión. Ejecuta `pnpm login`.");
      process.exitCode = 1;
      return;
    }
    const { browser, context } = await launchBrowser({
      headless: true,
      storageStatePath: getLinkedInSessionPath(),
    });
    const ok = await validateLinkedInSession(context);
    await context.close();
    await browser.close();
    if (ok) {
      logger.info("Sesión válida.");
    } else {
      logger.warn("Sesión inválida o expirada.");
      process.exitCode = 1;
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error("check-session: " + err.message);
    process.exitCode = 1;
  }
}

async function cmdClearSession(): Promise<void> {
  try {
    clearSessionFile();
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error("clear-session: " + err.message);
    process.exitCode = 1;
  }
}

async function cmdRun(dryRun: boolean, maxJobs: number): Promise<void> {
  try {
    const effectiveDry = dryRun || env.DRY_RUN;
    await runApplicationPipeline({ dryRun: effectiveDry, maxJobs });
    logger.info("Ejecución finalizada.");
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error("run: " + err.message);
    process.exitCode = 1;
  }
}

async function cmdStatus(): Promise<void> {
  try {
    await initDataLayer();
    const rows = listTrackedApplications(100);
    if (rows.length === 0) {
      logger.info("No hay postulaciones registradas.");
      return;
    }
    for (const r of rows) {
      const line = [
        r.id,
        r.jobPostId,
        r.status,
        r.appliedAt?.toISOString() ?? "-",
        r.cvPath ?? "-",
        r.error ?? "",
      ].join(" | ");
      logger.info(line);
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error("status: " + err.message);
    process.exitCode = 1;
  }
}

const program = new Command();
program
  .name("job-applier")
  .description("Agente local de postulación (LinkedIn + Claude + LanceDB)");

program
  .command("login")
  .description("Abre el navegador para iniciar sesión en LinkedIn y guarda la sesión")
  .action(async () => {
    await cmdLogin();
  });

program
  .command("check-session")
  .description("Comprueba si la sesión guardada sigue siendo válida")
  .action(async () => {
    await cmdCheckSession();
  });

program
  .command("clear-session")
  .description("Elimina el archivo de sesión de LinkedIn")
  .action(async () => {
    await cmdClearSession();
  });

program
  .command("run")
  .description("Busca empleos, genera CV y envía Easy Apply")
  .option("--dry-run", "No enviar formularios; solo registrar acciones", false)
  .option("--max-jobs <n>", "Máximo de ofertas a procesar", "5")
  .action(async (opts: { dryRun?: boolean; maxJobs?: string }) => {
    const maxJobs = Number.parseInt(String(opts.maxJobs ?? "5"), 10);
    if (Number.isNaN(maxJobs) || maxJobs < 1) {
      logger.error("--max-jobs debe ser un entero >= 1");
      process.exitCode = 1;
      return;
    }
    await cmdRun(Boolean(opts.dryRun), maxJobs);
  });

program
  .command("status")
  .description("Lista el historial de postulaciones")
  .action(async () => {
    await cmdStatus();
  });

program.parse();
