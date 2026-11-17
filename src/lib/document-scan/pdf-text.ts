import type { ScanWord } from "./types";

// Reads the words (with their positions) from a PDF page's own text layer. No browser APIs are used here,
// so the same code runs in the browser and in tests.

type TextItemLike = { str?: string; transform?: number[]; width?: number; height?: number };
export type PdfPageLike = {
  getViewport(options: { scale: number }): { transform: number[]; scale: number };
  getTextContent(): Promise<{ items: unknown[] }>;
};
export type PdfUtilLike = { transform(a: number[], b: number[]): number[] };

export async function textLayerWords(page: PdfPageLike, util: PdfUtilLike): Promise<ScanWord[]> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const words: ScanWord[] = [];

  for (const raw of content.items) {
    const item = raw as TextItemLike;
    if (typeof item.str !== "string" || item.str.trim() === "" || !item.transform) continue;

    const tx = util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]) || (item.height ?? 0) * viewport.scale || 10;
    // Sideways or upside-down text cannot be read as a row, so it is skipped.
    if (Math.abs(tx[1]) > Math.abs(tx[0]) * 0.1) continue;

    const length = item.str.length;
    const width = (item.width ?? 0) * viewport.scale || length * fontHeight * 0.5;
    const x0 = tx[4];
    const baseline = tx[5];

    for (const match of item.str.matchAll(/\S+/g)) {
      const start = match.index ?? 0;
      words.push({
        text: match[0],
        x0: x0 + (width * start) / length,
        x1: x0 + (width * (start + match[0].length)) / length,
        top: baseline - fontHeight * 0.8,
        bottom: baseline + fontHeight * 0.2,
      });
    }
  }
  return words;
}

/** How much real text a page has: a scanned page has almost none. */
export function characterCount(words: ScanWord[]): number {
  return words.reduce((sum, word) => sum + word.text.length, 0);
}
