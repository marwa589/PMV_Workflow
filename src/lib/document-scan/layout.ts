import type { ScanPage, ScanWord } from "./types";

// Groups loose words into reading rows and cells. Works the same for words from a PDF text layer and from OCR,
// because every threshold is relative to the height of the text on that row, never an absolute size.

export type Row = {
  page: number;
  source: "text" | "ocr";
  words: ScanWord[];
  top: number;
  bottom: number;
  height: number;
  /** A gap wider than this between two words means "next cell". */
  cellGap: number;
  text: string;
};

export type Cell = { start: number; end: number; words: ScanWord[]; x0: number; x1: number; text: string };

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** "Date:12/01/2025" arrives as one word from some PDFs and OCR runs; make it two so label and value separate. */
function splitGluedColons(words: ScanWord[]): ScanWord[] {
  const out: ScanWord[] = [];
  for (const word of words) {
    const m = word.text.match(/^([A-Za-z][A-Za-z.#/&()-]*):(\S+)$/);
    if (!m) {
      out.push(word);
      continue;
    }
    const width = word.x1 - word.x0;
    const cut = word.x0 + (width * (m[1].length + 1)) / word.text.length;
    out.push({ ...word, text: `${m[1]}:`, x1: cut });
    out.push({ ...word, text: m[2], x0: cut });
  }
  return out;
}

export function buildRows(pages: ScanPage[]): Row[] {
  const rows: Row[] = [];
  for (const page of pages) {
    const words = splitGluedColons(page.words.filter((word) => word.text.trim() !== "")).map((word) => ({
      ...word,
      text: word.text.trim(),
      bottom: Math.max(word.bottom, word.top + 1),
    }));
    const sorted = [...words].sort((a, b) => (a.top + a.bottom) / 2 - (b.top + b.bottom) / 2);

    const groups: ScanWord[][] = [];
    let centre = 0;
    let height = 0;
    for (const word of sorted) {
      const wordCentre = (word.top + word.bottom) / 2;
      const current = groups[groups.length - 1];
      if (current && Math.abs(wordCentre - centre) <= 0.55 * Math.max(height, 1)) {
        current.push(word);
        centre = current.reduce((sum, item) => sum + (item.top + item.bottom) / 2, 0) / current.length;
        height = median(current.map((item) => item.bottom - item.top));
      } else {
        groups.push([word]);
        centre = wordCentre;
        height = word.bottom - word.top;
      }
    }

    for (const group of groups) {
      const ordered = [...group].sort((a, b) => a.x0 - b.x0);
      const rowHeight = Math.max(median(ordered.map((item) => item.bottom - item.top)), 1);
      rows.push({
        page: page.pageNumber,
        source: page.source,
        words: ordered,
        top: Math.min(...ordered.map((item) => item.top)),
        bottom: Math.max(...ordered.map((item) => item.bottom)),
        height: rowHeight,
        cellGap: rowHeight * 0.9,
        text: ordered.map((item) => item.text).join(" "),
      });
    }
  }
  return rows;
}

export function gapBefore(row: Row, index: number): number {
  return index === 0 ? Infinity : row.words[index].x0 - row.words[index - 1].x1;
}

export function cellsOf(row: Row): Cell[] {
  const cells: Cell[] = [];
  let start = 0;
  for (let i = 1; i <= row.words.length; i++) {
    if (i === row.words.length || gapBefore(row, i) > row.cellGap) {
      const words = row.words.slice(start, i);
      cells.push({ start, end: i - 1, words, x0: words[0].x0, x1: words[words.length - 1].x1, text: words.map((word) => word.text).join(" ") });
      start = i;
    }
  }
  return cells;
}
