import { readFileSync, existsSync } from "node:fs";
import { z } from "zod";
import { env } from "./env.js";

// ────────────────────────────────────────────────────────────
// Raw schema (matches profile.json structure)
// ────────────────────────────────────────────────────────────

const educationSchema = z.object({
  institution: z.string().min(1),
  title: z.string().min(1),
  /** "degree" | "certification" | "course" | any string */
  type: z.string().default("degree"),
  year: z.string().optional(),
});

const languageSchema = z.object({
  language: z.string().min(1),
  level: z.string().min(1),
});

const rawProfileSchema = z.object({
  profileInformation: z.object({
    fullName: z.string().min(1),
    professionalTitle: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(1),
    location: z.string().min(1),
    education: z.array(educationSchema).default([]),
    languages: z.array(languageSchema).default([]),
  }),
  jobPreferences: z.object({
    salaryExpectation: z.string().optional(),
    salaryCurrency: z.string().default("USD"),
    roles: z.array(z.string()).min(1, "Se necesita al menos un rol en jobPreferences.roles"),
    modality: z.array(z.string()).default([]),
    employmentType: z.array(z.string()).default([]),
  }),
});

type RawProfile = z.infer<typeof rawProfileSchema>;

// ────────────────────────────────────────────────────────────
// Computed helpers (flat aliases used en todo el codebase)
// ────────────────────────────────────────────────────────────

function buildSummary(p: RawProfile): string {
  const pi = p.profileInformation;
  const jp = p.jobPreferences;
  const langStr = pi.languages.map((l) => `${l.language} (${l.level})`).join(", ");
  const rolesStr = jp.roles.join(", ");
  const modalityStr = jp.modality.length > 0 ? jp.modality.join("/") : "";
  const salaryNote =
    jp.salaryExpectation
      ? ` Expectativa salarial: ${jp.salaryExpectation} ${jp.salaryCurrency}.`
      : "";
  const modalityNote = modalityStr ? ` Modalidad preferida: ${modalityStr}.` : "";
  return (
    `${pi.professionalTitle} con sede en ${pi.location}. ` +
    `Especialista en ${rolesStr}.` +
    modalityNote +
    salaryNote +
    (langStr ? ` Idiomas: ${langStr}.` : "")
  );
}

/**
 * Construye la query de búsqueda en LinkedIn a partir de todos los roles.
 * LinkedIn acepta OR en keywords → amplía cobertura sin sacrificar relevancia.
 */
function buildSearchQuery(p: RawProfile): string {
  const roles = p.jobPreferences.roles.slice(0, 4);
  return roles.join(" OR ");
}

/**
 * LinkedIn acepta "Lima, Perú" directamente; es más preciso que solo "Perú".
 */
function buildSearchLocation(p: RawProfile): string {
  return p.profileInformation.location;
}

// ────────────────────────────────────────────────────────────
// Exported types
// ────────────────────────────────────────────────────────────

/**
 * Tipo enriquecido: contiene la estructura anidada del JSON
 * más alias planos para compatibilidad con el resto del codebase.
 */
export interface UserProfile extends RawProfile {
  /** Alias plano de profileInformation.fullName */
  fullName: string;
  /** Alias plano de profileInformation.email */
  email: string;
  /** Alias plano de profileInformation.phone */
  phone: string;
  /** Alias plano de profileInformation.location */
  location: string;
  /** Resumen profesional generado a partir del perfil */
  summary: string;
  /** Query de búsqueda construida desde jobPreferences.roles */
  searchQuery: string;
  /** Ubicación de búsqueda (profileInformation.location) */
  searchLocation: string;
}

// ────────────────────────────────────────────────────────────
// Loader
// ────────────────────────────────────────────────────────────

export function loadProfile(): UserProfile {
  const path = env.profilePathAbs;
  if (!existsSync(path)) {
    throw new Error(
      `No se encontró el perfil en ${path}. Crea profile.json o ajusta PROFILE_PATH en .env.`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    throw new Error(`profile.json no es JSON válido: ${err.message}`);
  }

  const parsed = rawProfileSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`profile.json inválido: ${issues}`);
  }

  const raw = parsed.data;
  return {
    ...raw,
    fullName: raw.profileInformation.fullName,
    email: raw.profileInformation.email,
    phone: raw.profileInformation.phone,
    location: raw.profileInformation.location,
    summary: buildSummary(raw),
    searchQuery: buildSearchQuery(raw),
    searchLocation: buildSearchLocation(raw),
  };
}
