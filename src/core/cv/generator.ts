import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import type { JobPost } from "@/types/index.js";
import type { UserProfile } from "@/config/profile.js";
import { env } from "@/config/env.js";
import { logger } from "@/utils/logger.js";

const MODEL = "claude-sonnet-4-20250514";

const promptDir = join(dirname(fileURLToPath(import.meta.url)), "prompts");

function loadPrompt(name: "tailor.md" | "cover.md"): string {
  const path = join(promptDir, name);
  return readFileSync(path, "utf-8");
}

function fillTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}

function extractTextContent(response: {
  content: Array<{ type: string; text?: string }>;
}): string {
  const parts: string[] = [];
  for (const block of response.content) {
    if (block.type === "text" && "text" in block && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("\n").trim();
}

export async function generateTailoredCvMarkdown(
  profile: UserProfile,
  job: JobPost,
): Promise<string> {
  try {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY no está definida. Añádela en .env para generar CV con Claude.",
      );
    }
    const template = loadPrompt("tailor.md");
    const prompt = fillTemplate(template, {
      PROFILE_JSON: JSON.stringify(profile, null, 2),
      JOB_DESCRIPTION: job.description,
    });

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const text = extractTextContent(response);
    if (!text) {
      throw new Error("Respuesta vacía del modelo al generar el CV");
    }
    return text;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error("generateTailoredCvMarkdown: " + err.message);
    throw err;
  }
}

export async function generateCoverLetter(
  profile: UserProfile,
  job: JobPost,
): Promise<string> {
  try {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY no está definida. Añádela en .env para generar la carta con Claude.",
      );
    }
    const template = loadPrompt("cover.md");
    const prompt = fillTemplate(template, {
      PROFILE_JSON: JSON.stringify(profile, null, 2),
      JOB_TITLE: job.title,
      COMPANY: job.company,
      JOB_DESCRIPTION: job.description,
    });

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    return extractTextContent(response);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error("generateCoverLetter: " + err.message);
    throw err;
  }
}
