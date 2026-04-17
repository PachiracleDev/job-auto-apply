function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Retardo corto aleatorio entre acciones de UI (Playwright). */
export async function humanDelay(): Promise<void> {
  const ms = randInt(400, 1200);
  await new Promise((r) => setTimeout(r, ms));
}

/** Retardo medio para navegación o esperas de red. */
export async function randomDelay(): Promise<void> {
  const ms = randInt(800, 2200);
  await new Promise((r) => setTimeout(r, ms));
}

/** Retardo largo entre postulaciones para reducir tasa de solicitudes. */
export async function longDelay(): Promise<void> {
  const ms = randInt(8000, 18000);
  await new Promise((r) => setTimeout(r, ms));
}
