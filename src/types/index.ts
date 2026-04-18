export interface JobPost {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  portal: "linkedin";
  scrapedAt: Date;
  vector?: number[];
}

/** Oferta recolectada (solo Easy Apply), lista para exportar a JSON. */
export interface JobListingSnapshot {
  id: string;
  title: string;
  company: string;
  /** Línea de ubicación (ciudad, región) si se extrajo. */
  location: string;
  /** País (solo país) cuando se puede inferir sin inventar. */
  country: string;
  /** Descripción / requisitos (texto principal del puesto). */
  requirements: string;
  /** Texto visible sobre postulantes, ej. "14 solicitudes". */
  applicantsLabel: string;
  /** Texto visible sobre antigüedad, ej. "Hace 2 días". */
  postedLabel: string;
  /** URL de la ficha (vista del empleo). */
  url: string;
  /** Enlace directo a flujo de candidatura (Easy Apply) si se detectó. */
  applyUrl: string;
  /** Tokens consumidos en la llamada OpenAI al estructurar la ficha (solo si `collect` usó IA). */
  openAiTokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  easyApply: true;
  /** true si se detectó el botón de candidatura sencilla en la ficha. */
  easyApplyVerifiedOnPage: boolean;
  scrapedAt: string;
}

export interface CVData {
  jobPostId: string;
  content: string;
  pdfPath?: string;
  generatedAt: Date;
}

export type AppStatus = "pending" | "applied" | "failed" | "skipped" | "duplicate";

export interface AppRecord {
  id: string;
  jobPostId: string;
  status: AppStatus;
  appliedAt?: Date;
  error?: string;
  cvPath?: string;
}

export interface Portal {
  name: "linkedin";
  baseUrl: string;
  searchUrl: (
    query: string,
    location: string,
    options?: { easyApplyOnly?: boolean },
  ) => string;
  selectors: Record<string, string>;
}
