import { createHash } from "node:crypto";
import type { JobPost } from "@/types/index.js";

export const EMBEDDING_DIM = 384;

export function buildDedupText(
  job: Pick<JobPost, "title" | "company" | "description">,
): string {
  return `${job.title}\n${job.company}\n${job.description}`;
}

function normalize(vec: number[]): number[] {
  let n = 0;
  for (const x of vec) n += x * x;
  const norm = Math.sqrt(n) || 1;
  return vec.map((x) => x / norm);
}

/** Embedding denso determinista a partir de n-gramas de caracteres (sin modelo ML). */
export function embedText(text: string): number[] {
  const cleaned = text.toLowerCase().replace(/\s+/g, " ").trim();
  const vec = new Array(EMBEDDING_DIM).fill(0);
  const n = 3;
  for (let i = 0; i <= Math.max(0, cleaned.length - n); i++) {
    const gram = cleaned.slice(i, i + n);
    const h = createHash("sha256").update(gram).digest();
    for (let d = 0; d < EMBEDDING_DIM; d++) {
      const b = h[d % 32];
      vec[d] += (b / 127.5) - 1;
    }
  }
  if (cleaned.length < n) {
    const h = createHash("sha256").update(cleaned).digest();
    for (let d = 0; d < EMBEDDING_DIM; d++) {
      const b = h[d % 32];
      vec[d] += (b / 127.5) - 1;
    }
  }
  return normalize(vec);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
