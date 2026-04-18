import type { Locator } from "playwright-core";

export type ModalFieldKind = "textarea" | "text" | "select" | "radio";

export interface ModalFieldSpec {
  index: number;
  kind: ModalFieldKind;
  /** Texto de etiqueta / contexto para la IA */
  label: string;
  /** Valor actual (vacío si no hay) */
  current: string;
  /** Solo para kind === "select" o "radio": opciones visibles */
  options?: string[];
}

/** Escape mínimo para usar id en `label[for="..."]` en selectores CSS. */
function cssEscapeId(id: string): string {
  return id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function labelForControl(modal: Locator, el: Locator): Promise<string> {
  const aria = (await el.getAttribute("aria-label"))?.trim();
  if (aria) return aria;
  const ph = (await el.getAttribute("placeholder"))?.trim();
  if (ph) return ph;
  const name = (await el.getAttribute("name"))?.trim();
  if (name) return name;
  const id = await el.getAttribute("id");
  if (id) {
    const forSel = `label[for="${cssEscapeId(id)}"]`;
    const lbl = modal.locator(forSel).first();
    if ((await lbl.count()) > 0) {
      const t = (await lbl.innerText().catch(() => "")).trim();
      if (t) return t;
    }
  }
  return "";
}

async function radioGroupLabel(group: Locator): Promise<string> {
  const legend = group.locator("legend").first();
  if ((await legend.count()) > 0) {
    const t = (await legend.innerText().catch(() => "")).trim();
    if (t) return t;
  }
  const headerSel = [
    '[data-test-form-element-label-title]',
    '[id]',
    'label',
    'span[class*="title"]',
    'span[class*="label"]',
  ];
  for (const sel of headerSel) {
    const el = group.locator(sel).first();
    if ((await el.count()) > 0) {
      const t = (await el.innerText().catch(() => "")).trim();
      if (t && t.length < 200) return t;
    }
  }
  return "";
}

async function radioGroupOptionLabels(group: Locator): Promise<string[]> {
  const labels = group.locator('label:has(input[type="radio"]), label + input[type="radio"]');
  const directLabels = await labels.allInnerTexts().catch(() => [] as string[]);
  if (directLabels.length > 0) {
    return directLabels.map((t) => t.trim()).filter(Boolean);
  }

  const inputs = group.locator('input[type="radio"]:visible');
  const n = await inputs.count();
  const opts: string[] = [];
  for (let i = 0; i < n; i++) {
    const rb = inputs.nth(i);
    const id = await rb.getAttribute("id");
    let lbl = "";
    if (id) {
      lbl = await group
        .locator(`label[for="${cssEscapeId(id)}"]`)
        .innerText()
        .catch(() => "");
    }
    if (!lbl) {
      const ariaLabel = await rb.getAttribute("aria-label");
      lbl = ariaLabel ?? (await rb.getAttribute("value")) ?? "";
    }
    const t = lbl.trim();
    if (t) opts.push(t);
  }
  return opts;
}

/**
 * Lista estable de campos editables en el modal visible.
 * Orden: textareas → text inputs → selects → radio groups.
 */
export async function collectModalFieldSpecs(modal: Locator): Promise<ModalFieldSpec[]> {
  const out: ModalFieldSpec[] = [];
  let index = 0;

  // Textareas
  const textareas = modal.locator("textarea:visible");
  const nTa = await textareas.count();
  for (let i = 0; i < nTa; i++) {
    const ta = textareas.nth(i);
    if (!(await ta.isEditable().catch(() => false))) continue;
    const label = await labelForControl(modal, ta);
    const current = (await ta.inputValue().catch(() => "")).trim();
    out.push({ index: index++, kind: "textarea", label: label || `textarea-${String(i)}`, current });
  }

  // Text inputs (excluye hidden, radio, checkbox, file, submit)
  const inputs = modal.locator(
    'input:visible:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]):not([type="submit"])',
  );
  const nIn = await inputs.count();
  for (let i = 0; i < nIn; i++) {
    const input = inputs.nth(i);
    if (!(await input.isEditable().catch(() => false))) continue;
    const label = await labelForControl(modal, input);
    const current = (await input.inputValue().catch(() => "")).trim();
    out.push({ index: index++, kind: "text", label: label || `input-${String(i)}`, current });
  }

  // Native selects
  const selects = modal.locator("select:visible");
  const nSel = await selects.count();
  for (let i = 0; i < nSel; i++) {
    const sel = selects.nth(i);
    const label = await labelForControl(modal, sel);
    const opts = (await sel.locator("option").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
    const current = (await sel.inputValue().catch(() => "")).trim();
    out.push({
      index: index++,
      kind: "select",
      label: label || `select-${String(i)}`,
      current,
      options: opts,
    });
  }

  // Radio groups (solo los que no tienen selección previa)
  const groups = modal.locator('fieldset:has(input[type="radio"]), [role="radiogroup"]');
  const nGr = await groups.count();
  for (let i = 0; i < nGr; i++) {
    const g = groups.nth(i);
    const picked = g.locator('input[type="radio"]:checked');
    if ((await picked.count()) > 0) continue;
    const label = await radioGroupLabel(g);
    const options = await radioGroupOptionLabels(g);
    if (options.length === 0) continue;
    out.push({
      index: index++,
      kind: "radio",
      label: label || `radio-group-${String(i)}`,
      current: "",
      options,
    });
  }

  return out;
}

const CLICK_TIMEOUT_MS = 25_000;

async function clickRadioByLabel(
  group: Locator,
  targetLabel: string,
): Promise<boolean> {
  const inputs = group.locator('input[type="radio"]:visible');
  const n = await inputs.count();
  for (let k = 0; k < n; k++) {
    const rb = inputs.nth(k);
    const id = await rb.getAttribute("id");
    let lbl = "";
    if (id) {
      lbl = await group
        .locator(`label[for="${cssEscapeId(id)}"]`)
        .innerText()
        .catch(() => "");
    }
    if (!lbl) {
      lbl =
        (await rb.getAttribute("aria-label")) ?? (await rb.getAttribute("value")) ?? "";
    }
    if (lbl.trim().toLowerCase().includes(targetLabel.toLowerCase())) {
      await rb.scrollIntoViewIfNeeded();
      await rb.click({ timeout: CLICK_TIMEOUT_MS }).catch(() => undefined);
      return true;
    }
  }
  return false;
}

/**
 * Aplica respuestas de la IA por índice de campo (mismo orden que collectModalFieldSpecs).
 */
export async function applyModalFieldAnswers(
  modal: Locator,
  specs: ModalFieldSpec[],
  answers: Array<{ index: number; value: string }>,
): Promise<void> {
  const byIndex = new Map<number, string>();
  for (const a of answers) {
    if (typeof a.index !== "number" || typeof a.value !== "string") continue;
    byIndex.set(a.index, a.value);
  }

  const textareas = modal.locator("textarea:visible");
  const inputs = modal.locator(
    'input:visible:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]):not([type="submit"])',
  );
  const selects = modal.locator("select:visible");
  const radioGroups = modal.locator('fieldset:has(input[type="radio"]), [role="radiogroup"]');

  let ti = 0;
  let ii = 0;
  let si = 0;
  let ri = 0;

  for (const spec of specs) {
    const val = (byIndex.get(spec.index) ?? "").trim();

    if (spec.kind === "textarea") {
      const ta = textareas.nth(ti++);
      if (val === "") continue;
      if (!(await ta.isEditable().catch(() => false))) continue;
      await ta.fill(val);
      continue;
    }

    if (spec.kind === "text") {
      const input = inputs.nth(ii++);
      if (val === "") continue;
      if (!(await input.isEditable().catch(() => false))) continue;
      await input.fill(val);
      continue;
    }

    if (spec.kind === "select") {
      const sel = selects.nth(si++);
      if (val === "") continue;
      try {
        await sel.selectOption({ label: val });
      } catch {
        await sel.selectOption({ value: val }).catch(() => undefined);
      }
      continue;
    }

    if (spec.kind === "radio") {
      const g = radioGroups.nth(ri++);
      if (val === "") continue;
      const hit = await clickRadioByLabel(g, val);
      if (!hit) {
        const firstRadio = g.locator('input[type="radio"]:visible').first();
        await firstRadio.click({ timeout: CLICK_TIMEOUT_MS }).catch(() => undefined);
      }
    }
  }
}
