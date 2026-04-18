import { Hono } from "hono";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { profiles, providerSessions } from "../db/schema.js";
import { decryptSessionBytes } from "../crypto/sessionCrypto.js";
import { runLinkedInSearch } from "../services/runLinkedInSearch.js";
import type { InMemoryStorageState } from "../../../src/core/scraper/browser.js";

const searchBody = z.object({
  userId: z.number().int().positive(),
  provider: z.literal("linkedin"),
  roles: z.array(z.string()).min(1),
  modality: z.array(z.string()).default([]),
  employmentType: z.array(z.string()).default([]),
  maxJobs: z.number().int().min(1).max(100).default(30),
});

export const jobsRoutes = new Hono();

jobsRoutes.post("/v1/jobs/search", async (c) => {
  let body: z.infer<typeof searchBody>;
  try {
    body = searchBody.parse(await c.req.json());
  } catch {
    return c.json({ error: "Body inválido" }, 400);
  }

  const [profile] = await getDb()
    .select()
    .from(profiles)
    .where(eq(profiles.userId, body.userId))
    .limit(1);
  if (!profile) {
    return c.json({ error: "Perfil no encontrado. Sincroniza PUT /v1/users/:id/profile." }, 404);
  }

  const [sessionRow] = await getDb()
    .select()
    .from(providerSessions)
    .where(
      and(
        eq(providerSessions.userId, body.userId),
        eq(providerSessions.provider, body.provider),
      ),
    )
    .limit(1);
  if (!sessionRow) {
    return c.json(
      { error: "No hay sesión del proveedor. Usa POST /v1/providers/linkedin/sign-in." },
      404,
    );
  }

  let storageState: InMemoryStorageState;
  try {
    const plain = decryptSessionBytes(
      Buffer.from(sessionRow.storageStateEncrypted),
    );
    storageState = JSON.parse(plain.toString("utf8")) as InMemoryStorageState;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: "No se pudo descifrar la sesión: " + msg }, 500);
  }

  const query = body.roles.join(" OR ");
  const headless = process.env["WORKER_HEADLESS"] !== "false";

  try {
    const jobs = await runLinkedInSearch({
      storageState,
      query,
      location: profile.location,
      maxJobs: body.maxJobs,
      headless,
    });

    return c.json({
      generatedAt: new Date().toISOString(),
      provider: body.provider,
      searchQuery: query,
      searchLocation: profile.location,
      count: jobs.length,
      jobs,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});
