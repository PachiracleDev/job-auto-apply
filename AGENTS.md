# Job Auto Applier — Project Prompt

You are a senior TypeScript engineer building a production-grade
automated job application agent. The system runs locally, uses
Playwright for browser automation, Claude API for CV personalization,
and LanceDB for vector-based deduplication.

## Project structure to generate

## Scripts (raíz)

| Comando | Descripción |
|---------|-------------|
| `pnpm cli -- <args>` | CLI (Commander): `pnpm cli -- login`, `pnpm cli -- collect`, `pnpm cli -- apply`, etc. |
| `pnpm worker` | Servidor HTTP del worker. Usa **Bun** si está en PATH; si no, **tsx**. Requiere `.env` con `DATABASE_URL`, `WORKER_API_KEY`, `SESSION_ENCRYPTION_KEY`. |
| `pnpm worker:dev` | Igual, en modo **watch** (`bun --watch` o `tsx watch`). |
| `pnpm --filter job-applier-worker run start` | Solo tsx (sin detección de Bun). |
| `pnpm worker:db:migrate` | Aplicar migraciones Drizzle en Postgres. |

**Bun (opcional):** instálalo desde [bun.sh](https://bun.sh). Tras instalarlo, `pnpm worker` y `pnpm worker:dev` lo usarán automáticamente. Sin Bun, todo sigue funcionando con Node + tsx.
