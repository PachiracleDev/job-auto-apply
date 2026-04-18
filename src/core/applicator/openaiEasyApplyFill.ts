import OpenAI from "openai";
import { z } from "zod";
import { logger } from "@/utils/logger.js";
import type { ModalFieldSpec } from "@/core/applicator/linkedinModalFields.js";
import type { UserProfile } from "@/config/profile.js";

const answersSchema = z.object({
  answers: z.array(
    z.object({
      index: z.number(),
      value: z.string(),
    }),
  ),
});

export interface EasyApplyJobContext {
  title: string;
  company: string;
  description: string;
}

export interface OpenAiEasyApplyFillResult {
  answers: Array<{ index: number; value: string }>;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
}

function usageFromCompletion(completion: {
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
}): OpenAiEasyApplyFillResult["usage"] {
  const u = completion.usage;
  if (!u) return null;
  return {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  };
}

const SYSTEM = `Eres un asistente experto en completar formularios de solicitud de empleo (LinkedIn Easy Apply) para un candidato que busca trabajo como desarrollador de software senior.

════════ FORMATO DE SALIDA ════════
Devuelve SOLO JSON con la clave "answers": array de { "index": number, "value": string }.
"index" debe coincidir exactamente con el índice del campo en la lista recibida.
No incluyas markdown ni texto fuera del JSON.

════════ IDIOMA ════════
Redacta en el mismo idioma que las etiquetas del formulario (español o inglés). Si hay duda, usa el mismo idioma que la mayoría de las etiquetas.

════════ DATOS INAMOVIBLES (nunca inventar ni modificar) ════════
Nombre completo, correo electrónico y teléfono: úsalos SOLO desde el bloque "DATOS ANCLADOS" del mensaje del usuario, carácter por carácter.
Fechas de inicio/fin de empleo y nombre de empresa: respeta EXACTAMENTE los del perfil.
Títulos académicos formales: solo los que aparezcan en education del perfil.

════════ CAMPOS NUMÉRICOS Y DE EXPERIENCIA ════════
- Años de experiencia con una tecnología: razona desde la fecha de inicio en el perfil hasta hoy (2026). Redondea a entero.
  - Si la tecnología aparece en los roles o descripción de trabajo y es común en el stack del candidato, calcula un número razonable (no inflado, no menor de lo esperable para un senior).
  - Si el formulario pide un rango como "0-1", "1-3", "3-5", "5-10", elige el rango más alto que sea creíble con la trayectoria del perfil.
- Nivel en una tecnología (novice / intermediate / advanced / expert o similar): elige "Advanced" o equivalente salvo que la trayectoria sugiera "Expert" claramente.
- Salario esperado: usa exactamente salaryExpectation y salaryCurrency del perfil. Si el formulario pide otra moneda, convierte con aproximación razonable (CLP, USD, ARS, etc.) y anota solo el número.

════════ SELECTS Y RADIOS ════════
- "value" debe ser EXACTAMENTE una de las opciones listadas para ese campo (copia literal, incluye mayúsculas/acentos).
- Para modalidad de trabajo: prioriza la que mejor coincida con "modality" del perfil (remote > hybrid > on-site).
- Para tipo de empleo: prioriza la que coincida con "employmentType" del perfil (full-time, contract…).
- Para nivel de idioma: mapea a la escala del formulario (C1 → Advanced / Fluent; Nativo → Native / C2).

════════ TEXTOS ABIERTOS ════════
- Carta de presentación / cover letter: profesional, personalizada al puesto, ≤ 4 párrafos cortos. Menciona el nombre del candidato al cerrar.
- Campos de "describe tu experiencia" o "¿por qué eres el candidato ideal?": respuesta convincente orientada al puesto, sin exagerar.
- Campos ya rellenados (current != ""): no los incluyas en answers (deja que el formulario conserve su valor).

════════ REGLA GENERAL ════════
Maximiza la probabilidad de ser contactado presentando al candidato como un profesional senior sólido y honesto, sin contradicciones con los datos del perfil.
Si un campo genuinamente no aplica y no hay forma razonable de responder, usa "" como value (omite ese campo).`;


export async function fetchEasyApplyFieldAnswersWithOpenAi(options: {
  apiKey: string;
  model: string;
  profile: UserProfile;
  /** Nota sobre el CV en PDF (ruta o descripción); el contenido resume el perfil. */
  cvNote: string;
  job: EasyApplyJobContext;
  fields: ModalFieldSpec[];
}): Promise<OpenAiEasyApplyFillResult> {
  const client = new OpenAI({ apiKey: options.apiKey });

  const fieldsJson = JSON.stringify(
    options.fields.map((f) => ({
      index: f.index,
      kind: f.kind,
      label: f.label,
      current: f.current,
      ...(f.options && f.options.length > 0 ? { options: f.options } : {}),
    })),
    null,
    2,
  );

  const p = options.profile;
  const pi = p.profileInformation;
  const jp = p.jobPreferences;

  const educationLines = (pi?.education ?? [])
    .map((e) => `  - ${e.title} — ${e.institution} (${e.type}, ${e.year ?? "s/f"})`)
    .join("\n");
  const languageLines = (pi?.languages ?? [])
    .map((l) => `  - ${l.language}: ${l.level}`)
    .join("\n");

  const todayYear = new Date().getFullYear();

  const userContent = [
    "════════ DATOS ANCLADOS (copia literal en campos de nombre/email/teléfono) ════════",
    `fullName : ${p.fullName}`,
    `email    : ${p.email}`,
    `phone    : ${p.phone}`,
    "",
    "════════ PERFIL DEL CANDIDATO ════════",
    `Nombre              : ${p.fullName}`,
    `Título profesional  : ${pi?.professionalTitle ?? "Ingeniero de software"}`,
    `Ubicación           : ${p.location}`,
    `Año actual (para calcular años de experiencia): ${String(todayYear)}`,
    "",
    "Educación:",
    educationLines || "  (no especificada)",
    "",
    "Idiomas:",
    languageLines || "  (no especificados)",
    "",
    "Preferencias laborales:",
    `  Roles            : ${jp?.roles.join(", ") ?? ""}`,
    `  Modalidad        : ${jp?.modality.join(", ") ?? ""}`,
    `  Tipo empleo      : ${jp?.employmentType.join(", ") ?? ""}`,
    `  Salario esperado : ${jp?.salaryExpectation ?? ""} ${jp?.salaryCurrency ?? ""}`,
    "",
    "════════ PUESTO OFERTADO ════════",
    `Título  : ${options.job.title}`,
    `Empresa : ${options.job.company}`,
    "Descripción / requisitos:",
    options.job.description.slice(0, 10_000),
    "",
    "════════ CV (referencia) ════════",
    options.cvNote,
    "",
    "════════ CAMPOS DEL FORMULARIO ════════",
    "Completa SOLO los que tengan current vacío o < 20 caracteres. Para campos ya rellenos (current larga), no los incluyas.",
    fieldsJson,
    "",
    'Devuelve JSON: { "answers": [ { "index": 0, "value": "..." } ] }',
  ].join("\n");

  const completion = await client.chat.completions.create({
    model: options.model,
    temperature: 0.35,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userContent },
    ],
  });

  const usage = usageFromCompletion(completion);
  const raw = completion.choices[0]?.message?.content?.trim() ?? "";
  if (!raw) {
    logger.warn("OpenAI Easy Apply: respuesta vacía.");
    return { answers: [], usage };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    logger.warn("OpenAI Easy Apply: JSON inválido.");
    return { answers: [], usage };
  }

  const safe = answersSchema.safeParse(parsed);
  if (!safe.success) {
    logger.warn("OpenAI Easy Apply: esquema inválido: " + safe.error.message);
    return { answers: [], usage };
  }

  return { answers: safe.data.answers, usage };
}
