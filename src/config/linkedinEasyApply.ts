/**
 * Selectores y variantes de texto para el modal de Easy Apply.
 * LinkedIn cambia el DOM con frecuencia: mantener listas amplias y fallbacks.
 */

export const EASY_APPLY_MODAL = [
  ".jobs-easy-apply-modal",
  "[data-test-modal-container]",
  '[role="dialog"]',
].join(", ");

/** Botón inicial Easy Apply (tarjeta del puesto). */
export const EASY_APPLY_ENTRY = [
  "button.jobs-apply-button--top-card",
  "button[data-live-test-easy-apply-button]",
  "button.jobs-apply-button",
  'button[aria-label*="Easy Apply"]',
  'button[aria-label*="easy apply"]',
  'button[aria-label*="Solicitud sencilla"]',
  'button[aria-label*="solicitud sencilla"]',
  'a[data-live-test-easy-apply-button]',
].join(", ");

/** Cerrar / descartar modal. */
export const DISMISS = [
  "button.jobs-easy-apply-modal__footer-cancel-btn",
  "button.artdeco-modal__dismiss",
  'button[aria-label="Dismiss"]',
  'button[aria-label="Descartar"]',
  'button[data-test-modal-close-btn]',
].join(", ");

/** Enviar solicitud final. */
export const SUBMIT = [
  'button[aria-label="Submit application"]',
  'button[aria-label="Enviar solicitud"]',
  'button:has-text("Submit application")',
  'button:has-text("Enviar solicitud")',
  "button.jobs-apply-button",
  'button[data-live-test-submit-application-button]',
].join(", ");

/** Revisar antes de enviar (a veces aparece antes del Submit). */
export const REVIEW = [
  'button[aria-label="Review"]',
  'button[aria-label="Revisar"]',
  'button:has-text("Review")',
  'button:has-text("Revisar")',
].join(", ");

/** Siguiente paso. */
export const NEXT = [
  'button[aria-label="Continue to next step"]',
  'button[aria-label="Continuar al siguiente paso"]',
  'button:has-text("Next")',
  'button:has-text("Siguiente")',
  'button[data-live-test-next-button]',
  'button[data-easy-apply-next-button]',
].join(", ");

/** Spinners / overlays que deben desaparecer antes de interactuar. */
export const LOADING = [
  ".artdeco-loader--small",
  ".jobs-easy-apply-modal [data-test-id='loading']",
  '[aria-busy="true"]',
].join(", ");
