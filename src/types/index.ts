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
  searchUrl: (query: string, location: string) => string;
  selectors: Record<string, string>;
}
