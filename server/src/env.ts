import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
/** Carga `.env` de la raíz del monorepo (job-auto-apply/.env). */
config({ path: resolve(dir, "../../.env") });
