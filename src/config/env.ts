import { config as loadEnv } from "dotenv";
import { z } from "zod";
import { resolve } from "node:path";

loadEnv();

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  DATA_DIR: z.string().default("./data"),
  OUTPUT_DIR: z.string().default("./output"),
  BROWSER_PATH: z.string().optional(),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  DRY_RUN: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  PROFILE_PATH: z.string().default("./profile.json"),
});

export type Env = z.infer<typeof envSchema> & {
  dataDirAbs: string;
  outputDirAbs: string;
  profilePathAbs: string;
};

function parseEnv(): Env {
  const raw = {
    ANTHROPIC_API_KEY: process.env["ANTHROPIC_API_KEY"] ?? "",
    DATA_DIR: process.env["DATA_DIR"],
    OUTPUT_DIR: process.env["OUTPUT_DIR"],
    BROWSER_PATH: process.env["BROWSER_PATH"],
    LOG_LEVEL: process.env["LOG_LEVEL"],
    DRY_RUN: process.env["DRY_RUN"],
    PROFILE_PATH: process.env["PROFILE_PATH"],
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
  return {
    ...e,
    DRY_RUN: Boolean(e.DRY_RUN),
    dataDirAbs: resolve(process.cwd(), e.DATA_DIR),
    outputDirAbs: resolve(process.cwd(), e.OUTPUT_DIR),
    profilePathAbs: resolve(process.cwd(), e.PROFILE_PATH),
  };
}

export const env: Env = parseEnv();
