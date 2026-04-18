import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";
import sharp from "sharp";
import type { CVData } from "@/types/index.js";
import { env } from "@/config/env.js";
import { logger } from "@/utils/logger.js";

const LINE_HEIGHT = 14;
const MARGIN = 48;
const MAX_CHARS_PER_LINE = 95;

function wrapLine(line: string, max = MAX_CHARS_PER_LINE): string[] {
  const words = line.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= max) {
      cur = next;
    } else {
      if (cur) lines.push(cur);
      cur = w.length > max ? w.slice(0, max) : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function wrapText(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\n/)) {
    const trimmed = raw.trimEnd();
    if (!trimmed) {
      out.push("");
      continue;
    }
    out.push(...wrapLine(trimmed));
  }
  return out;
}

/** Copia el PDF base (DEFAULT_CV_PDF) a output con el nombre del trabajo. */
export async function copyDefaultCvPdfToOutput(baseName: string): Promise<string> {
  try {
    mkdirSync(env.outputDirAbs, { recursive: true });
    const pdfPath = join(env.outputDirAbs, `${baseName}.pdf`);
    if (!existsSync(env.defaultCvPdfAbs)) {
      throw new Error(
        `No se encuentra el CV predeterminado: ${env.defaultCvPdfAbs}`,
      );
    }
    copyFileSync(env.defaultCvPdfAbs, pdfPath);
    return pdfPath;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error("copyDefaultCvPdfToOutput: " + err.message);
    throw err;
  }
}

export async function renderCvPdf(cv: CVData, baseName: string): Promise<string> {
  try {
    mkdirSync(env.outputDirAbs, { recursive: true });
    const pdfPath = join(env.outputDirAbs, `${baseName}.pdf`);

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const lines = wrapText(cv.content);
    let page = pdf.addPage([595, 842]);
    let { width, height } = page.getSize();
    let y = height - MARGIN;

    const draw = (text: string) => {
      page.drawText(text, {
        x: MARGIN,
        y,
        size: 11,
        font,
        color: rgb(0.1, 0.1, 0.1),
        maxWidth: width - MARGIN * 2,
      });
      y -= LINE_HEIGHT;
      if (y < MARGIN) {
        page = pdf.addPage([595, 842]);
        ({ width, height } = page.getSize());
        y = height - MARGIN;
      }
    };

    for (const line of lines) {
      draw(line);
    }

    const bytes = await pdf.save();
    writeFileSync(pdfPath, bytes);
    return pdfPath;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error("renderCvPdf: " + err.message);
    throw err;
  }
}

export async function bundleCvArtifacts(options: {
  baseName: string;
  cvMarkdown: string;
  coverLetter: string;
  pdfPath: string;
}): Promise<string> {
  try {
    mkdirSync(env.outputDirAbs, { recursive: true });
    const zipPath = join(env.outputDirAbs, `${options.baseName}.zip`);
    const zip = new JSZip();
    zip.file("cv.md", options.cvMarkdown);
    zip.file("cover.txt", options.coverLetter);
    zip.file("cv.pdf", readFileSync(options.pdfPath));

    const thumb = await sharp({
      create: {
        width: 120,
        height: 40,
        channels: 3,
        background: { r: 240, g: 240, b: 245 },
      },
    })
      .png()
      .toBuffer();
    zip.file("thumb.png", thumb);

    const data = await zip.generateAsync({ type: "nodebuffer" });
    writeFileSync(zipPath, data);
    return zipPath;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error("bundleCvArtifacts: " + err.message);
    throw err;
  }
}
