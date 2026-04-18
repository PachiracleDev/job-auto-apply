/**
 * A partir del texto largo que devuelve Readability/HTML de la ficha de LinkedIn,
 * extrae título/aprox. ubicación en cabecera, etiquetas de publicación y postulantes,
 * y deja solo el bloque "Acerca del empleo" en requirements.
 */

const ABOUT_START = /acerca del empleo/i;

/** Cortes típicos del panel derecho / Premium / empresa (español e inglés). */
const BODY_END_MARKERS: string[] = [
  "Establecer una alerta para empleos similares",
  "Establecer una alerta",
  "Acerca de la empresa",
  "Búsqueda de empleo más rápida con Premium",
  "Búsqueda de empleo más eficaz con Premium",
  "Búsqueda de empleo más rápida",
  "Personas con las que puedes hablar",
  "Conoce al equipo de contratación",
  "Mira una comparación con los otros",
  "Volver a probar Premium",
  "Requisitos añadidos por el anunciante",
  "Compromisos",
  "Más información",
  "About the company",
  "Meet the hiring team",
  "Similar jobs",
];

export interface ParsedLinkedInJobText {
  title: string;
  /** Línea de cabecera con ubicación si se detectó (ej. "Lima, Perú"). */
  locationLine: string;
  applicantsLabel: string;
  postedLabel: string;
  /** Solo descripción del puesto (sección Acerca del empleo). */
  aboutJob: string;
}

function minIndex(haystack: string, needles: string[]): number {
  let min = haystack.length;
  for (const n of needles) {
    const i = haystack.indexOf(n);
    if (i !== -1 && i < min) min = i;
  }
  return min;
}

/**
 * Cabecera antes de "Acerca del empleo": suele traer título, · hace X · N solicitudes.
 */
function parseHeaderBlock(header: string): {
  title: string;
  locationLine: string;
  applicantsLabel: string;
  postedLabel: string;
} {
  let applicantsLabel = "";
  const sol = header.match(/(\d+)\s+solicitudes/i);
  if (sol) applicantsLabel = sol[0].trim();
  else {
    const m = header.match(/más\s+de\s+(\d+)\s+postulantes/i);
    if (m) applicantsLabel = m[0].trim();
  }

  let postedLabel = "";
  const posted = header.match(
    /hace\s+\d+\s+(?:segundo|segundos|minuto|minutos|hora|horas|día|días|semana|semanas|mes|meses|año|años)/i,
  );
  if (posted) postedLabel = posted[0].trim();
  else {
    const postedEn = header.match(
      /\b(\d+\s*(?:second|minute|hour|day|week|month)s?\s+ago)\b/i,
    );
    if (postedEn) postedLabel = postedEn[0].trim();
  }

  const firstLine = (header.split(/\n/)[0] ?? header).trim();
  let title = "";
  let locationLine = "";

  const stripPromo = firstLine.replace(/\s*Promocionado\b.*$/i, "").trim();

  const byDot = stripPromo.split(/\s*·\s*/);
  if (byDot.length >= 2) {
    let head = byDot[0].trim();
    head = head.replace(/^[\s\p{Extended_Pictographic}]+/u, "").trim();
    const lima = head.match(/^(.+?)\s+(Lima,\s*Perú|Perú|Remote|Remoto)\s*$/i);
    if (lima) {
      title = lima[1].trim();
      locationLine = lima[2].trim();
    } else {
      title = head;
    }
  } else {
    let t = stripPromo.replace(/^[\s\p{Extended_Pictographic}]+/u, "").trim();
    const cut = t.match(/^(.+?)(?=\s{2,}Lima,|\s+Lima,\s*Perú)/i);
    if (cut) title = cut[1].trim();
    else title = t.split(/\s{2,}/)[0] ?? t;
  }

  return { title, locationLine, applicantsLabel, postedLabel };
}

function sliceAboutJobOnly(raw: string): string {
  const m = raw.match(ABOUT_START);
  if (!m || m.index === undefined) {
    return raw.trim();
  }
  let body = raw.slice(m.index + m[0].length).trim();
  body = body.replace(/^[\s:·\-\u200b]+/, "");
  const end = minIndex(body, BODY_END_MARKERS);
  body = body.slice(0, end).trim();
  return body;
}

export function parseLinkedInJobFields(raw: string): ParsedLinkedInJobText {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      title: "",
      locationLine: "",
      applicantsLabel: "",
      postedLabel: "",
      aboutJob: "",
    };
  }

  const aboutIdx = trimmed.search(ABOUT_START);
  /** Si el texto lineal empieza ya en "Acerca del empleo", no hay cabecera útil antes: no mezclar descripción en el título. */
  const headerForParse =
    aboutIdx > 0
      ? trimmed.slice(0, aboutIdx)
      : aboutIdx === 0
        ? ""
        : trimmed.slice(0, Math.min(2500, trimmed.length));

  const headerParsed = parseHeaderBlock(headerForParse);

  const aboutJob = sliceAboutJobOnly(trimmed);

  return {
    title: headerParsed.title,
    locationLine: headerParsed.locationLine,
    applicantsLabel: headerParsed.applicantsLabel,
    postedLabel: headerParsed.postedLabel,
    aboutJob: aboutJob || trimmed,
  };
}
