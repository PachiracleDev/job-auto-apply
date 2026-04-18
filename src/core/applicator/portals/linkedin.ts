import { existsSync } from "node:fs";
import type { Locator, Page } from "playwright-core";
import type { JobPost } from "@/types/index.js";
import type { UserProfile } from "@/config/profile.js";
import { env } from "@/config/env.js";
import {
  DISMISS,
  EASY_APPLY_ENTRY,
  EASY_APPLY_MODAL,
  LOADING,
  NEXT,
  REVIEW,
  SUBMIT,
} from "@/config/linkedinEasyApply.js";
import {
  applyModalFieldAnswers,
  collectModalFieldSpecs,
} from "@/core/applicator/linkedinModalFields.js";
import { fetchEasyApplyFieldAnswersWithOpenAi } from "@/core/applicator/openaiEasyApplyFill.js";
import { humanDelay, randomDelay } from "@/utils/delay.js";
import { logger } from "@/utils/logger.js";

export interface ApplyLinkedInOptions {
  dryRun: boolean;
  profile: UserProfile;
  /**
   * URL directa al flujo Easy Apply (/jobs/view/.../apply). Si se define, no se hace clic en el botón de la ficha.
   */
  applyUrl?: string;
  /** Ruta absoluta o relativa al cwd del PDF a adjuntar (por defecto DEFAULT_CV_PDF). */
  cvPdfPath?: string;
  /** false fuerza solo heurísticas. Por defecto sigue env (IA si hay OPENAI_API_KEY). */
  useOpenAiForm?: boolean;
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
    // Solo rellenar si el campo está prácticamente vacío (la IA ya lo pudo rellenar antes)
    if (current.length > 30) continue;

    if (hint.includes("cover") || hint.includes("carta") || hint.includes("presentaci") || hint.includes("mensaje")) {
      await ta.fill(
        `Estimado equipo de contratación,\n\nMe interesa esta posición y creo que encajo bien con el perfil buscado.\n\nSaludos,\n${profile.fullName}`,
      );
    } else {
      await ta.fill(profile.summary.slice(0, 2000));
    }
    await humanDelay();
  }
}

function isApplicantFullNameField(label: string): boolean {
  if (
    label.includes("company") ||
    label.includes("empresa") ||
    label.includes("employer") ||
    label.includes("school") ||
    label.includes("universidad")
  ) {
    return false;
  }
  if (
    label.includes("job title") ||
    label.includes("título del puesto") ||
    label.includes("titulo del puesto") ||
    label.includes("nombre del puesto")
  ) {
    return false;
  }
  if (label.includes("full name") || label.includes("nombre completo")) return true;
  if (label.includes("your name") || label.includes("tu nombre")) return true;
  if (label.includes("nombre") && !label.includes("proyecto")) return true;
  return false;
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

    const isEmail =
      label.includes("email") || label.includes("correo") || label.includes("e-mail");
    const isPhone =
      label.includes("phone") ||
      label.includes("tel") ||
      label.includes("móvil") ||
      label.includes("mobile") ||
      label.includes("celular");
    const isFullName = isApplicantFullNameField(label);
    /** Nombre, email y teléfono siempre del perfil (pisan lo que haya escrito la IA). */
    const forceFromProfile = isEmail || isPhone || isFullName;
    if (val.length > 0 && !forceFromProfile) continue;

    if (isEmail) {
      await input.fill(profile.email);
    } else if (isPhone) {
      await input.fill(profile.phone);
    } else if (isFullName) {
      await input.fill(profile.fullName);
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
    const current = (await sel.inputValue().catch(() => "")).trim();
    if (current !== "") continue;
    try {
      await sel.selectOption({ index: 1 });
    } catch {
      await sel.selectOption({ index: 0 }).catch(() => undefined);
    }
    await humanDelay();
  }
}

/** Palabras clave relacionadas con modalidad de trabajo. */
const MODALITY_HINTS = [
  "modali", "remote", "remoto", "hybrid", "híbrido", "presenci",
  "work type", "tipo de trabajo", "trabajo desde", "work location",
];

const MODALITY_NORMALIZERS: Record<string, string[]> = {
  remote:   ["remote", "remoto", "100% remoto", "desde casa", "work from home", "fully remote"],
  hybrid:   ["hybrid", "híbrido", "hibrido", "mixto"],
  on_site:  ["on-site", "on site", "presencial", "in-office", "in office", "en oficina"],
};

function buildModalityKeywords(preferred: string[]): string[] {
  const kws: string[] = [];
  for (const pref of preferred) {
    const key = pref.toLowerCase().replace(/-/g, "_");
    kws.push(...(MODALITY_NORMALIZERS[key] ?? [pref.toLowerCase()]));
  }
  return kws;
}

async function fillRadioGroups(modal: Locator, profile: UserProfile): Promise<void> {
  const preferredModality = profile.jobPreferences?.modality ?? [];
  const modalityKws = buildModalityKeywords(preferredModality);

  const groups = modal.locator(
    'fieldset:has(input[type="radio"]), [role="radiogroup"]',
  );
  const gc = await groups.count();
  for (let i = 0; i < gc; i++) {
    const g = groups.nth(i);
    const picked = g.locator('input[type="radio"]:checked');
    if ((await picked.count()) > 0) continue;

    const radios = g.locator('input[type="radio"]:visible');
    if ((await radios.count()) === 0) continue;

    // Detecta si el grupo es sobre modalidad/tipo de trabajo
    const groupText = (await g.innerText().catch(() => "")).toLowerCase();
    const isModalityGroup = MODALITY_HINTS.some((h) => groupText.includes(h));

    if (isModalityGroup && modalityKws.length > 0) {
      // Intenta clicar el radio cuya etiqueta coincide con la preferencia
      let clicked = false;
      const n = await radios.count();
      for (let k = 0; k < n && !clicked; k++) {
        const rb = radios.nth(k);
        const id = await rb.getAttribute("id");
        let lbl = "";
        if (id) {
          lbl = await g
            .locator(`label[for="${id.replace(/"/g, '\\"')}"]`)
            .innerText()
            .catch(() => "");
        }
        if (!lbl) lbl = (await rb.getAttribute("aria-label")) ?? (await rb.getAttribute("value")) ?? "";
        const lblLow = lbl.trim().toLowerCase();
        if (modalityKws.some((kw) => lblLow.includes(kw))) {
          await rb.scrollIntoViewIfNeeded();
          await rb.click({ timeout: CLICK_TIMEOUT_MS }).catch(() => undefined);
          clicked = true;
        }
      }
      if (!clicked) {
        const first = radios.first();
        await first.scrollIntoViewIfNeeded();
        await first.click({ timeout: CLICK_TIMEOUT_MS }).catch(() => undefined);
      }
    } else {
      const first = radios.first();
      await first.scrollIntoViewIfNeeded();
      await first.click({ timeout: CLICK_TIMEOUT_MS }).catch(() => undefined);
    }
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
  await fillRadioGroups(modal, profile);
  await checkRequiredCheckboxes(modal);
}

async function uploadResumePdf(
  modal: Locator,
  page: Page,
  cvPath: string,
): Promise<void> {
  if (!existsSync(cvPath)) {
    logger.warn(`CV no encontrado en ${cvPath}; se omite la subida.`);
    return;
  }
  const fileInput = modal.locator('input[type="file"]');
  if ((await fileInput.count()) === 0) return;
  try {
    await fileInput.first().setInputFiles(cvPath);
    await humanDelay();
    await waitForLoadingGone(page, 15_000);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn(`No se pudo adjuntar el CV: ${msg}`);
  }
}

async function fillModalStep(
  modal: Locator,
  page: Page,
  job: JobPost,
  profile: UserProfile,
  applyOptions: ApplyLinkedInOptions,
): Promise<void> {
  const cvPath = applyOptions.cvPdfPath ?? env.defaultCvPdfAbs;
  await uploadResumePdf(modal, page, cvPath);

  const useAi =
    (applyOptions.useOpenAiForm ?? env.applyUseOpenAiForm) &&
    env.OPENAI_API_KEY.length > 0;

  if (useAi) {
    try {
      const specs = await collectModalFieldSpecs(modal);
      if (specs.length > 0) {
        const { answers } = await fetchEasyApplyFieldAnswersWithOpenAi({
          apiKey: env.OPENAI_API_KEY,
          model: env.APPLY_OPENAI_MODEL,
          profile,
          cvNote: `Archivo PDF del CV: ${cvPath}. Contenido alineado con el perfil JSON.`,
          job: {
            title: job.title,
            company: job.company,
            description: job.description,
          },
          fields: specs,
        });
        await applyModalFieldAnswers(modal, specs, answers);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(`Easy Apply (IA): ${msg}`);
    }
  }

  await fillVisibleFields(modal, profile);
}

export async function applyLinkedInEasyApply(
  page: Page,
  job: JobPost,
  options: ApplyLinkedInOptions,
): Promise<void> {
  try {
    const directApply = Boolean(options.applyUrl?.trim());
    const startUrl = directApply ? options.applyUrl!.trim() : job.url;

    await page.goto(startUrl, { waitUntil: "domcontentloaded" });
    await randomDelay();

    if (!directApply) {
      const entry = page.locator(EASY_APPLY_ENTRY).first();
      await entry
        .waitFor({ state: "visible", timeout: 45_000 })
        .catch(() => undefined);

      if ((await entry.count()) === 0 || !(await entry.isVisible().catch(() => false))) {
        logger.info("Easy Apply no disponible para " + job.url);
        return;
      }
    }

    if (options.dryRun) {
      logger.warn(
        `[dry-run] Se habría abierto Easy Apply para: ${job.title} @ ${job.company}` +
          (directApply ? ` (${startUrl})` : ""),
      );
      return;
    }

    if (!directApply) {
      const entry = page.locator(EASY_APPLY_ENTRY).first();
      await entry.scrollIntoViewIfNeeded();
      await entry.click({ timeout: CLICK_TIMEOUT_MS });
      await humanDelay();
    }

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

      await fillModalStep(modal, page, job, options.profile, options);
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
