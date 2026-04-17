import type { Locator, Page } from "playwright-core";
import type { JobPost } from "@/types/index.js";
import type { UserProfile } from "@/config/profile.js";
import {
  DISMISS,
  EASY_APPLY_ENTRY,
  EASY_APPLY_MODAL,
  LOADING,
  NEXT,
  REVIEW,
  SUBMIT,
} from "@/config/linkedinEasyApply.js";
import { humanDelay, randomDelay } from "@/utils/delay.js";
import { logger } from "@/utils/logger.js";

export interface ApplyLinkedInOptions {
  dryRun: boolean;
  profile: UserProfile;
}

const MAX_STEPS = 40;
const MODAL_WAIT_MS = 45_000;
const CLICK_TIMEOUT_MS = 25_000;

function firstLocator(page: Page, selectorCsv: string): Locator {
  const parts = selectorCsv.split(",").map((s) => s.trim()).filter(Boolean);
  return page.locator(parts.join(", "));
}

async function waitForLoadingGone(page: Page, timeoutMs: number): Promise<void> {
  const loader = firstLocator(page, LOADING).first();
  try {
    await loader.waitFor({ state: "hidden", timeout: timeoutMs });
  } catch {
    /* sin spinner o ya oculto */
  }
  await humanDelay();
}

async function getActiveModal(page: Page): Promise<Locator> {
  const modal = page.locator(EASY_APPLY_MODAL).last();
  await modal.waitFor({ state: "visible", timeout: MODAL_WAIT_MS });
  await waitForLoadingGone(page, 15_000);
  return modal;
}

async function scrollAndClickOne(target: Locator): Promise<boolean> {
  try {
    await target.scrollIntoViewIfNeeded();
    await target.waitFor({ state: "visible", timeout: CLICK_TIMEOUT_MS });
    await waitForLoadingGone(target.page(), 8_000);
    if (await target.isDisabled().catch(() => false)) return false;
    await target.click({ timeout: CLICK_TIMEOUT_MS });
    await humanDelay();
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.debug(`click fallido: ${msg}`);
    return false;
  }
}

async function clickFirstEnabled(
  scope: Page | Locator,
  selectorCsv: string,
): Promise<boolean> {
  const group = scope.locator(selectorCsv);
  const n = await group.count();
  for (let i = 0; i < n; i++) {
    const btn = group.nth(i);
    if (!(await btn.isVisible().catch(() => false))) continue;
    if (await btn.isDisabled().catch(() => false)) continue;
    if (await scrollAndClickOne(btn)) return true;
  }
  return false;
}

/** Prioridad: Submit > Review > Next (LinkedIn a veces muestra Review antes del envío). */
async function clickStepButton(modal: Locator): Promise<
  "submit" | "review" | "next" | "none"
> {
  if (await clickFirstEnabled(modal, SUBMIT)) return "submit";
  if (await clickFirstEnabled(modal, REVIEW)) return "review";
  if (await clickFirstEnabled(modal, NEXT)) return "next";
  return "none";
}

async function dismissModal(page: Page): Promise<void> {
  await clickFirstEnabled(page, DISMISS);
}

async function fillTextAreas(modal: Locator, profile: UserProfile): Promise<void> {
  const areas = modal.locator("textarea:visible");
  const n = await areas.count();
  for (let i = 0; i < n; i++) {
    const ta = areas.nth(i);
    if (!(await ta.isEditable())) continue;
    const hint = `${(await ta.getAttribute("placeholder")) ?? ""} ${(await ta.getAttribute("aria-label")) ?? ""} ${(await ta.getAttribute("name")) ?? ""}`.toLowerCase();
    const current = (await ta.inputValue().catch(() => "")).trim();
    if (current.length > 20) continue;

    if (hint.includes("cover") || hint.includes("carta") || hint.includes("mensaje")) {
      await ta.fill(
        `Estimado equipo de contratación,\n\nMe interesa esta posición y creo que encajo con el rol descrito.\n\nSaludos,\n${profile.fullName}`,
      );
    } else {
      await ta.fill(profile.summary.slice(0, 2000));
    }
    await humanDelay();
  }
}

async function fillTextInputs(modal: Locator, profile: UserProfile): Promise<void> {
  const inputs = modal.locator(
    'input:visible:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]):not([type="submit"])',
  );
  const n = await inputs.count();
  for (let i = 0; i < n; i++) {
    const input = inputs.nth(i);
    if (!(await input.isEditable())) continue;
    const label = `${(await input.getAttribute("aria-label")) ?? ""} ${(await input.getAttribute("placeholder")) ?? ""} ${(await input.getAttribute("name")) ?? ""}`.toLowerCase();
    const val = (await input.inputValue().catch(() => "")).trim();
    if (val.length > 0) continue;

    if (
      label.includes("email") ||
      label.includes("correo") ||
      label.includes("e-mail")
    ) {
      await input.fill(profile.email);
    } else if (
      label.includes("phone") ||
      label.includes("tel") ||
      label.includes("móvil") ||
      label.includes("mobile")
    ) {
      await input.fill(profile.phone);
    } else if (
      label.includes("city") ||
      label.includes("ciudad") ||
      label.includes("location") ||
      label.includes("ubicación")
    ) {
      await input.fill(profile.location);
    } else if (label.includes("linkedin") || label.includes("url")) {
      await input.fill(profile.email);
    } else {
      continue;
    }
    await humanDelay();
  }
}

async function fillNativeSelects(modal: Locator): Promise<void> {
  const selects = modal.locator("select:visible");
  const n = await selects.count();
  for (let i = 0; i < n; i++) {
    const sel = selects.nth(i);
    const opts = await sel.locator("option").count();
    if (opts <= 1) continue;
    try {
      await sel.selectOption({ index: 1 });
    } catch {
      await sel.selectOption({ index: 0 }).catch(() => undefined);
    }
    await humanDelay();
  }
}

async function fillRadioGroups(modal: Locator): Promise<void> {
  const groups = modal.locator(
    'fieldset:has(input[type="radio"]), [role="radiogroup"]',
  );
  const gc = await groups.count();
  for (let i = 0; i < gc; i++) {
    const g = groups.nth(i);
    const picked = g.locator('input[type="radio"]:checked');
    if ((await picked.count()) > 0) continue;
    const first = g.locator('input[type="radio"]:visible').first();
    if ((await first.count()) === 0) continue;
    await first.scrollIntoViewIfNeeded();
    await first.click({ timeout: CLICK_TIMEOUT_MS }).catch(() => undefined);
    await humanDelay();
  }
}

async function checkRequiredCheckboxes(modal: Locator): Promise<void> {
  const boxes = modal.locator('input[type="checkbox"]:visible');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) {
    const cb = boxes.nth(i);
    const checked = await cb.isChecked().catch(() => true);
    if (checked) continue;
    const name = ((await cb.getAttribute("name")) ?? "").toLowerCase();
    const aria = ((await cb.getAttribute("aria-label")) ?? "").toLowerCase();
    const hint = `${name} ${aria}`;
    if (
      hint.includes("terms") ||
      hint.includes("privacy") ||
      hint.includes("policy") ||
      hint.includes("términos") ||
      hint.includes("privacidad") ||
      hint.includes("autorizo") ||
      hint.includes("confirm")
    ) {
      await cb.scrollIntoViewIfNeeded();
      await cb.click({ timeout: CLICK_TIMEOUT_MS }).catch(() => undefined);
      await humanDelay();
    }
  }
}

async function fillVisibleFields(
  modal: Locator,
  profile: UserProfile,
): Promise<void> {
  await fillTextAreas(modal, profile);
  await fillTextInputs(modal, profile);
  await fillNativeSelects(modal);
  await fillRadioGroups(modal);
  await checkRequiredCheckboxes(modal);
}

export async function applyLinkedInEasyApply(
  page: Page,
  job: JobPost,
  options: ApplyLinkedInOptions,
): Promise<void> {
  try {
    await page.goto(job.url, { waitUntil: "domcontentloaded" });
    await randomDelay();

    const entry = page.locator(EASY_APPLY_ENTRY).first();
    await entry
      .waitFor({ state: "visible", timeout: 45_000 })
      .catch(() => undefined);

    if ((await entry.count()) === 0 || !(await entry.isVisible().catch(() => false))) {
      logger.info("Easy Apply no disponible para " + job.url);
      return;
    }

    if (options.dryRun) {
      logger.warn(
        `[dry-run] Se habría abierto Easy Apply para: ${job.title} @ ${job.company}`,
      );
      return;
    }

    await entry.scrollIntoViewIfNeeded();
    await entry.click({ timeout: CLICK_TIMEOUT_MS });
    await humanDelay();

    let modal: Locator;
    try {
      modal = await getActiveModal(page);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      throw new Error(`No apareció el modal de Easy Apply: ${err.message}`);
    }

    let steps = 0;
    let lastAction: string | undefined;
    let stuck = 0;

    while (steps < MAX_STEPS) {
      steps += 1;
      await waitForLoadingGone(page, 20_000);
      modal = page.locator(EASY_APPLY_MODAL).last();
      if (!(await modal.isVisible().catch(() => false))) {
        logger.info(`Modal cerrado tras paso ${steps} (${job.id})`);
        break;
      }

      await fillVisibleFields(modal, options.profile);
      await waitForLoadingGone(page, 12_000);

      const action = await clickStepButton(modal);
      if (action === "none") {
        stuck += 1;
        if (stuck >= 3) {
          logger.warn(
            `Easy Apply sin botón reconocible tras ${String(stuck)} intentos; cerrando modal.`,
          );
          await dismissModal(page);
          throw new Error(
            "Formulario Easy Apply bloqueado: no se encontró Siguiente/Revisar/Enviar.",
          );
        }
        await humanDelay();
        continue;
      }
      stuck = 0;
      lastAction = action;

      if (action === "submit") {
        logger.info(`Enviado o último clic de envío para ${job.id} (${job.title})`);
        await randomDelay();
        await waitForLoadingGone(page, 30_000);
        break;
      }

      await randomDelay();
    }

    if (steps >= MAX_STEPS) {
      await dismissModal(page);
      throw new Error(
        "Easy Apply: demasiados pasos; posible bucle o formulario no soportado.",
      );
    }

    if (lastAction === "submit") {
      await page
        .locator(EASY_APPLY_MODAL)
        .waitFor({ state: "hidden", timeout: 60_000 })
        .catch(() => undefined);
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error("applyLinkedInEasyApply: " + err.message);
    throw err;
  }
}
