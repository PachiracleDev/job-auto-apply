import OpenAI from "openai";
import { z } from "zod";
import { logger } from "@/utils/logger.js";

const extractedSchema = z.object({
  company: z.string(),
  title: z.string(),
  requirements: z.string(),
  applicantsLabel: z.string(),
  postedLabel: z.string(),
  country: z.string(),
  location: z.string(),
  applyUrl: z.string(),
});

export type OpenAiExtractedJobFields = z.infer<typeof extractedSchema>;

export interface OpenAiTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

function usageFromCompletion(completion: {
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
}): OpenAiTokenUsage | null {
  const u = completion.usage;
  if (!u) return null;
  return {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  };
}

const SYSTEM = `Eres un extractor de datos para fichas de empleo de LinkedIn.
Reglas estrictas:
- Devuelves SOLO un objeto JSON válido, sin markdown ni texto fuera del JSON.
- No inventes empresa, título, requisitos ni cifras. Si algo no aparece claramente en el texto de entrada, usa cadena vacía "".
- Copia textos tal cual aparezcan (puedes unir líneas con espacio).
- applicantsLabel: texto sobre número de postulantes (ej. "14 solicitudes", "Más de 100 postulantes") o "".
- postedLabel: antigüedad del anuncio (ej. "hace 2 días", "Hace 1 semana") o "".
- country: solo el nombre del país si se deduce del texto (ej. "Perú"); si no hay país claro, "".
- location: ciudad/región si aparece (ej. "Lima, Perú"); si no, "".
- applyUrl: solo si en el texto aparece una URL absoluta de candidatura de LinkedIn que contenga /apply; si no, "".
Los campos company y title deben ser cortos (nombre empresa y nombre del puesto), no párrafos enteros.`;

function buildUserPayload(pageText: string, jobViewUrl: string): string {
  return [
    `URL de la ficha del empleo (referencia, no inventes datos que no estén en el texto): ${jobViewUrl}`,
    "",
    "Texto visible de la página (puede incluir ruido de navegación; ignora menús y pie si no son la ficha):",
    "",
    pageText,
  ].join("\n");
}

const emptyFields = (): OpenAiExtractedJobFields =>
  extractedSchema.parse({
    company: "",
    title: "",
    requirements: "",
    applicantsLabel: "",
    postedLabel: "",
    country: "",
    location: "",
    applyUrl: "",
  });

export async function parseLinkedInJobWithOpenAi(options: {
  apiKey: string;
  model: string;
  pageText: string;
  jobViewUrl: string;
}): Promise<{ fields: OpenAiExtractedJobFields; usage: OpenAiTokenUsage | null }> {
  const client = new OpenAI({ apiKey: options.apiKey });
  const userContent = buildUserPayload(options.pageText, options.jobViewUrl);

  const completion = await client.chat.completions.create({
    model: options.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content:
          userContent +
          '\n\nDevuelve JSON con las claves exactas: company, title, requirements, applicantsLabel, postedLabel, country, location, applyUrl (todas string).',
      },
    ],
  });

  const usage = usageFromCompletion(completion);

  const raw = completion.choices[0]?.message?.content?.trim() ?? "";
  if (!raw) {
    logger.warn("OpenAI devolvió contenido vacío; usando campos por defecto.");
    return { fields: emptyFields(), usage };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    logger.warn("OpenAI no devolvió JSON válido.");
    return { fields: emptyFields(), usage };
  }

  const safe = extractedSchema.safeParse(parsed);
  if (!safe.success) {
    logger.warn("JSON de OpenAI no coincide con el esquema: " + safe.error.message);
    return { fields: emptyFields(), usage };
  }

  return { fields: safe.data, usage };
}
