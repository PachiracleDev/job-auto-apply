import { createMiddleware } from "hono/factory";
import { timingSafeEqual } from "node:crypto";

function getExpectedKey(): string {
  const k = process.env["WORKER_API_KEY"]?.trim();
  if (!k) {
    throw new Error("WORKER_API_KEY no está definida.");
  }
  return k;
}

function extractBearer(authHeader: string | undefined): string | undefined {
  if (!authHeader?.startsWith("Bearer ")) return undefined;
  return authHeader.slice("Bearer ".length).trim();
}

export const apiKeyAuth = createMiddleware(async (c, next) => {
  let expected: string;
  try {
    expected = getExpectedKey();
  } catch {
    return c.json({ error: "Server misconfiguration" }, 500);
  }

  const header = c.req.header("authorization");
  const xKey = c.req.header("x-api-key");
  const provided = extractBearer(header) ?? xKey?.trim() ?? "";

  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (!timingSafeEqual(a, b)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
});
