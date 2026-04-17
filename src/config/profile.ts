import { readFileSync, existsSync } from "node:fs";
import { z } from "zod";
import { env } from "./env.js";

export const profileSchema = z.object({
  fullName: z.string().min(1),
  headline: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  location: z.string().min(1),
  summary: z.string().min(1),
  skills: z.array(z.string()).min(1),
  experience: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      start: z.string(),
      end: z.string().optional(),
      bullets: z.array(z.string()),
    }),
  ),
  education: z.array(
    z.object({
      school: z.string(),
      degree: z.string(),
      year: z.string().optional(),
    }),
  ),
  languages: z.array(z.string()).optional(),
  searchQuery: z.string().min(1),
  searchLocation: z.string().min(1),
});

export type UserProfile = z.infer<typeof profileSchema>;

export function loadProfile(): UserProfile {
  const path = env.profilePathAbs;
  if (!existsSync(path)) {
    throw new Error(
      `No se encontró el perfil en ${path}. Crea profile.json (ver README) o ajusta PROFILE_PATH.`,
    );
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const json: unknown = JSON.parse(raw);
    const parsed = profileSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        "profile.json inválido: " +
          parsed.error.issues.map((i) => i.message).join("; "),
      );
    }
    return parsed.data;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    throw new Error(`No se pudo cargar el perfil: ${err.message}`);
  }
}
