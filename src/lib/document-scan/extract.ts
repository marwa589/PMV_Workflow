"use client";

import { characterCount, textLayerWords, type PdfPageLike } from "./pdf-text";
import type { ScanPage, ScanWord } from "./types";

// Reads a file in the browser, for free and without sending it anywhere:
//  - a PDF page that has its own text is read directly (exact);
//  - a PDF page without text (a scan) and picture files are read with Tesseract OCR (English).
// The OCR engine and its English data are served from /ocr (copied from node_modules by scripts/copy-ocr-assets.mjs),
// so nothing is downloaded from a third party.

export type ScanProgress = { message: string; fraction: number | null };
type Report = (progress: ScanProgress) => void;

const MAX_PAGES = 30;
const MIN_TEXT_CHARACTERS = 25;
const OCR_TARGET_WIDTH = 1800; // pixels; about 200 dpi on a letter/A4 page

export const SCANNABLE_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];
export function canScan(file: File): boolean {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  return SCANNABLE_EXTENSIONS.includes(extension);
}

// ---------- OCR ----------

type OcrWorker = {
  recognize(image: unknown, options?: unknown, output?: unknown): Promise<{ data: unknown }>;
};
type OcrWord = { text?: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number } };

let workerPromise: Promise<OcrWorker> | null = null;
let activeReport: Report | null = null;

function getOcrWorker(): Promise<OcrWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const origin = window.location.origin;
      return (await createWorker("eng", 1, {
        workerPath: `${origin}/ocr/worker.min.js`,
        corePath: `${origin}/ocr`,
        langPath: `${origin}/ocr/lang`,
        gzip: true,
        logger: (event: { status?: string; progress?: number }) => {
          if (event.status === "recognizing text" && typeof event.progress === "number") {
            activeReport?.({ message: "Reading scanned text", fraction: event.progress });
          }
        },
      })) as unknown as OcrWorker;
    })().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

function collectOcrWords(data: unknown): OcrWord[] {
  const result = data as { words?: OcrWord[]; blocks?: Array<{ paragraphs?: Array<{ lines?: Array<{ words?: OcrWord[] }> }> }> };
  if (Array.isArray(result.words) && result.words.length > 0) return result.words;
  const words: OcrWord[] = [];
  for (const block of result.blocks ?? []) for (const paragraph of block.paragraphs ?? []) for (const line of paragraph.lines ?? []) words.push(...(line.words ?? []));
  return words;
}

async function ocrImage(image: unknown): Promise<ScanWord[]> {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(image, {}, { blocks: true });
  const words: ScanWord[] = [];
  for (const word of collectOcrWords(data)) {
    const text = (word.text ?? "").trim();
    if (!text || !word.bbox) continue;
    words.push({ text, x0: word.bbox.x0, x1: word.bbox.x1, top: word.bbox.y0, bottom: word.bbox.y1, conf: word.confidence });
  }
  return words;
}

// ---------- PDF ----------

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
  return pdfjs;
}

async function readPdf(file: File, report: Report): Promise<{ pages: ScanPage[]; skippedPages: number }> {
  const pdfjs = await loadPdfJs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const pages: ScanPage[] = [];
  const total = Math.min(pdf.numPages, MAX_PAGES);

  for (let pageNumber = 1; pageNumber <= total; pageNumber++) {
    report({ message: `Reading page ${pageNumber} of ${total}`, fraction: (pageNumber - 1) / total });
    const page = await pdf.getPage(pageNumber);
    const textWords = await textLayerWords(page as unknown as PdfPageLike, pdfjs.Util);

    if (characterCount(textWords) >= MIN_TEXT_CHARACTERS) {
      pages.push({ pageNumber, source: "text", words: textWords });
      continue;
    }

    // No text layer: draw the page and read the picture.
    report({ message: `Page ${pageNumber} of ${total} is a scan, reading it with OCR`, fraction: (pageNumber - 1) / total });
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: OCR_TARGET_WIDTH / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The browser could not prepare the page for reading.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, canvas, viewport }).promise;
    pages.push({ pageNumber, source: "ocr", words: await ocrImage(canvas) });
    canvas.width = 0;
    canvas.height = 0;
  }
  return { pages, skippedPages: Math.max(0, pdf.numPages - total) };
}

// ---------- entry point ----------

/** Returns the words of every page, or throws a readable Error when the file cannot be read. */
export async function extractPages(file: File, onProgress?: Report): Promise<{ pages: ScanPage[]; skippedPages: number }> {
  const report: Report = (progress) => onProgress?.(progress);
  activeReport = report;
  try {
    const extension = file.name.toLowerCase().split(".").pop() ?? "";
    if (extension === "pdf") {
      return await readPdf(file, report);
    }
    if (extension === "jpg" || extension === "jpeg" || extension === "png") {
      report({ message: "Reading the picture with OCR", fraction: 0 });
      return { pages: [{ pageNumber: 1, source: "ocr", words: await ocrImage(file) }], skippedPages: 0 };
    }
    throw new Error("Only PDF and picture files can be read automatically.");
  } finally {
    if (activeReport === report) activeReport = null;
  }
}
