import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

function getDatabaseUrl(): string {
  const url = process.env["DATABASE_URL"]?.trim();
  if (!url) {
    throw new Error("DATABASE_URL no está definida.");
  }
  return url;
}

let _client: ReturnType<typeof postgres> | undefined;
let _db: PostgresJsDatabase<typeof schema> | undefined;

function getClient(): ReturnType<typeof postgres> {
  if (!_client) {
    _client = postgres(getDatabaseUrl(), { max: 10 });
  }
  return _client;
}

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!_db) {
    _db = drizzle(getClient(), { schema });
  }
  return _db;
}

export { schema };
