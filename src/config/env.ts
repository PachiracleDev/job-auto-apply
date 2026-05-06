import { config as loadEnv } from "dotenv";
import { z } from "zod";
import { resolve } from "node:path";

loadEnv();

const boolFromEnv = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  /** Si es true, genera el CV con Claude (requiere ANTHROPIC_API_KEY). Si es false, se usa DEFAULT_CV_PDF. */
  CV_TAILOR_WITH_AI: boolFromEnv,
  /** Si es true, genera la carta con Claude (requiere ANTHROPIC_API_KEY). */
  COVER_LETTER_WITH_AI: boolFromEnv,
  /** Ruta al PDF base cuando CV_TAILOR_WITH_AI es false (relativa al cwd). */
  DEFAULT_CV_PDF: z.string().default("./cv/CV - ES.pdf"),
  DATA_DIR: z.string().default("./data"),
  OUTPUT_DIR: z.string().default("./output"),
  BROWSER_PATH: z.string().optional(),
  /**
   * WebSocket del servidor Playwright (`playwright run-server` / `launchServer`).
   * Ej.: ws://127.0.0.1:9222/ tras `docker compose up playwright-browser`.
   * Si está definido, no se lanza Chrome local: se usa `chromium.connect`.
   */
  PLAYWRIGHT_WS_ENDPOINT: z.string().optional(),
  /**
   * Alias legacy para compatibilidad con despliegues existentes.
   * Si viene definido y PLAYWRIGHT_WS_ENDPOINT no, se reutiliza.
   */
  PLAYWRIGHT_PDF_WS_ENDPOINT: z.string().optional(),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  DRY_RUN: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  PROFILE_PATH: z.string().default("./profile.json"),
  /**
   * Si es true, `pnpm collect` solo guarda ofertas cuando detecta el botón Easy Apply en la ficha.
   * Por defecto (false) confía en el filtro f_AL de la búsqueda y guarda igualmente (`easyApplyVerifiedOnPage` indica si hubo botón).
   */
  COLLECT_REQUIRE_EASY_APPLY_BUTTON: boolFromEnv,
  /** API key OpenAI para parsear fichas con modelo barato (recomendado en collect). */
  OPENAI_API_KEY: z.string().optional().default(""),
  /** Modelo barato y estable (ej. gpt-4o-mini). */
  COLLECT_OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  /**
   * "false" / "0" desactiva el parseo con OpenAI aunque exista OPENAI_API_KEY.
   * Si no se define y hay OPENAI_API_KEY, se usa OpenAI para extraer campos.
   */
  COLLECT_USE_OPENAI_PARSE: z.string().optional(),
  /** Modelo OpenAI para rellenar el modal Easy Apply (fase apply desde JSON). */
  APPLY_OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  /**
   * "false" / "0" desactiva el relleno con IA del formulario Easy Apply.
   * Por defecto, si hay OPENAI_API_KEY, se usa IA + heurísticas.
   */
  APPLY_USE_OPENAI_FORM: z.string().optional(),
});

export type Env = z.infer<typeof envSchema> & {
  dataDirAbs: string;
  outputDirAbs: string;
  profilePathAbs: string;
  defaultCvPdfAbs: string;
  /** true si se debe usar OpenAI para estructurar la ficha en collect. */
  useOpenAiCollectParse: boolean;
  /** true si se debe usar OpenAI para rellenar campos del modal Easy Apply. */
  applyUseOpenAiForm: boolean;
};

function parseEnv(): Env {
  const raw = {
    ANTHROPIC_API_KEY: process.env["ANTHROPIC_API_KEY"] ?? "",
    CV_TAILOR_WITH_AI: process.env["CV_TAILOR_WITH_AI"],
    COVER_LETTER_WITH_AI: process.env["COVER_LETTER_WITH_AI"],
    DEFAULT_CV_PDF: process.env["DEFAULT_CV_PDF"],
    DATA_DIR: process.env["DATA_DIR"],
    OUTPUT_DIR: process.env["OUTPUT_DIR"],
    BROWSER_PATH: process.env["BROWSER_PATH"],
    PLAYWRIGHT_WS_ENDPOINT: process.env["PLAYWRIGHT_WS_ENDPOINT"],
    PLAYWRIGHT_PDF_WS_ENDPOINT: process.env["PLAYWRIGHT_PDF_WS_ENDPOINT"],
    LOG_LEVEL: process.env["LOG_LEVEL"],
    DRY_RUN: process.env["DRY_RUN"],
    PROFILE_PATH: process.env["PROFILE_PATH"],
    COLLECT_REQUIRE_EASY_APPLY_BUTTON: process.env["COLLECT_REQUIRE_EASY_APPLY_BUTTON"],
    OPENAI_API_KEY: process.env["OPENAI_API_KEY"],
    COLLECT_OPENAI_MODEL: process.env["COLLECT_OPENAI_MODEL"],
    COLLECT_USE_OPENAI_PARSE: process.env["COLLECT_USE_OPENAI_PARSE"],
    APPLY_OPENAI_MODEL: process.env["APPLY_OPENAI_MODEL"],
    APPLY_USE_OPENAI_FORM: process.env["APPLY_USE_OPENAI_FORM"],
  };

  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error("Configuración inválida (.env):\n" + msg);
    process.exit(1);
  }

  const e = parsed.data;
  if (e.CV_TAILOR_WITH_AI && !e.ANTHROPIC_API_KEY) {
    console.error(
      "Configuración inválida (.env): CV_TAILOR_WITH_AI=true requiere ANTHROPIC_API_KEY.",
    );
    process.exit(1);
  }
  if (e.COVER_LETTER_WITH_AI && !e.ANTHROPIC_API_KEY) {
    console.error(
      "Configuración inválida (.env): COVER_LETTER_WITH_AI=true requiere ANTHROPIC_API_KEY.",
    );
    process.exit(1);
  }
  const playwrightWsEndpoint =
    e.PLAYWRIGHT_WS_ENDPOINT || e.PLAYWRIGHT_PDF_WS_ENDPOINT;

  const useOpenAiCollectParse =
    e.COLLECT_USE_OPENAI_PARSE === "false" || e.COLLECT_USE_OPENAI_PARSE === "0"
      ? false
      : e.OPENAI_API_KEY.length > 0;

  const applyUseOpenAiForm =
    e.APPLY_USE_OPENAI_FORM === "false" || e.APPLY_USE_OPENAI_FORM === "0"
      ? false
      : e.APPLY_USE_OPENAI_FORM === "true" || e.APPLY_USE_OPENAI_FORM === "1"
        ? true
        : e.OPENAI_API_KEY.length > 0;

  return {
    ...e,
    PLAYWRIGHT_WS_ENDPOINT: playwrightWsEndpoint,
    DRY_RUN: Boolean(e.DRY_RUN),
    dataDirAbs: resolve(process.cwd(), e.DATA_DIR),
    outputDirAbs: resolve(process.cwd(), e.OUTPUT_DIR),
    profilePathAbs: resolve(process.cwd(), e.PROFILE_PATH),
    defaultCvPdfAbs: resolve(process.cwd(), e.DEFAULT_CV_PDF),
    useOpenAiCollectParse,
    applyUseOpenAiForm,
  };
}

export const env: Env = parseEnv();
