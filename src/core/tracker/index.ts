import {
  insertApplication,
  listApplications,
  updateApplicationStatus,
} from "@/data/appStore.js";
import type { AppRecord, AppStatus } from "@/types/index.js";
import { logger } from "@/utils/logger.js";

export function startTracking(jobPostId: string): string {
  try {
    const id = insertApplication({ jobPostId, status: "pending" });
    logger.debug(`Seguimiento registrado (pending): ${id}`);
    return id;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error("startTracking: " + err.message);
    throw err;
  }
}

export function finishTracking(
  id: string,
  status: AppStatus,
  fields?: { error?: string; cvPath?: string; appliedAt?: Date },
): void {
  try {
    updateApplicationStatus(id, status, fields);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error("finishTracking: " + err.message);
    throw err;
  }
}

export function listTrackedApplications(limit = 50): AppRecord[] {
  try {
    return listApplications(limit);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error("listTrackedApplications: " + err.message);
    throw err;
  }
}
