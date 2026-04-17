import { Logger } from "tslog";
import { env } from "@/config/env.js";

/** IDs de nivel según tslog (ver Logger en node_modules/tslog). */
function logLevelToMin(level: string): number {
  const map: Record<string, number> = {
    trace: 1,
    debug: 2,
    info: 3,
    warn: 4,
    error: 5,
    fatal: 6,
  };
  return map[level] ?? 3;
}

export const logger = new Logger({
  name: "job-applier",
  minLevel: logLevelToMin(env.LOG_LEVEL),
  type: "pretty",
});
