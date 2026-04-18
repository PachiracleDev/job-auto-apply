import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { providerSessions } from "../db/schema.js";
import { encryptSessionBytes } from "../crypto/sessionCrypto.js";

const signInBody = z.object({
  userId: z.number().int().positive(),
  storageState: z.object({
    cookies: z.array(z.unknown()),
    origins: z.array(z.unknown()).optional(),
  }),
});

export const providerRoutes = new Hono();

providerRoutes.post("/v1/providers/:provider/sign-in", async (c) => {
  const provider = c.req.param("provider").toLowerCase();
  if (provider !== "linkedin") {
    return c.json({ error: "Proveedor no soportado" }, 400);
  }

  let body: z.infer<typeof signInBody>;
  try {
    body = signInBody.parse(await c.req.json());
  } catch {
    return c.json({ error: "Body inválido" }, 400);
  }

  const json = Buffer.from(JSON.stringify(body.storageState), "utf8");
  const encrypted = encryptSessionBytes(json);
  const now = new Date();

  await getDb()
    .insert(providerSessions)
    .values({
      userId: body.userId,
      provider,
      storageStateEncrypted: encrypted,
      encryptionKeyId: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [providerSessions.userId, providerSessions.provider],
      set: {
        storageStateEncrypted: encrypted,
        updatedAt: now,
      },
    });

  return c.json({ ok: true, provider });
});
