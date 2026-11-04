import { buildRows, cellsOf, gapBefore, type Cell, type Row } from "./layout";
import { parseForField } from "./parsers";
import type { Confidence, DocumentSuggestions, LineSuggestion, ScanField, ScanPage, ScanValues, ScanWord, Suggestion } from "./types";

// Matches the text of a document to the fields of its document type / sub type.
// It only uses what is in the document and in the field definitions: a field is filled when its label is found
// with a value next to it (or under it). Anything uncertain is marked "check", anything unclear is left empty.

const MAX_LINES = 500;
const STOP_WORDS = ["total", "subtotal", "sub total", "grand total", "tax", "vat", "notes", "note", "terms", "remarks", "signature", "prepared by", "approved by", "authorised", "authorized"];

// ---------- label matching ----------

const wordNorm = (word: ScanWord) => word.text.toLowerCase().replace(/[^a-z0-9]/g, "");
const labelTokens = (label: string) => label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[b.length];
}

// OCR sometimes misreads one letter. Allow that only on longer words, so "Qty" never matches "Qly".
function tokenEq(a: string, b: string, fuzzy: boolean): boolean {
  if (a === b) return true;
  return fuzzy && a.length >= 5 && b.length >= 5 && editDistance(a, b) <= 1;
}

type Span = { start: number; end: number; fuzzy: boolean };

/** Every place in the row where the label's words appear one after another. */
function findLabel(row: Row, tokens: string[]): Span[] {
  const spans: Span[] = [];
  if (tokens.length === 0) return spans;
  const fuzzyAllowed = row.source === "ocr";
  for (let i = 0; i < row.words.length; i++) {
    if (wordNorm(row.words[i]) === "") continue;
    let j = i;
    let t = 0;
    let usedFuzzy = false;
    let last = i;
    while (t < tokens.length && j < row.words.length) {
      const norm = wordNorm(row.words[j]);
      if (norm === "") {
        j++;
        continue;
      }
      if (!tokenEq(norm, tokens[t], fuzzyAllowed)) break;
      if (norm !== tokens[t]) usedFuzzy = true;
      last = j;
      t++;
      j++;
    }
    if (t === tokens.length) spans.push({ start: i, end: last, fuzzy: usedFuzzy });
  }
  return spans;
}

function startsSegment(row: Row, index: number): boolean {
  if (index === 0) return true;
  const previous = row.words[index - 1];
  return /[:;|]$/.test(previous.text) || wordNorm(previous) === "" || gapBefore(row, index) > row.cellGap;
}

/** A label that is followed by a colon, a gap, or the end of the row is clearly a label. */
function strongAfter(row: Row, end: number): boolean {
  if (/[:=]$/.test(row.words[end].text)) return true;
  const next = row.words[end + 1];
  if (!next) return true;
  return /^[:=\-–—]/.test(next.text) || next.x0 - row.words[end].x1 > row.cellGap;
}

type Occurrence = { field: ScanField; rowIdx: number; start: number; end: number; strong: boolean; fuzzy: boolean; labelLength: number; loose?: boolean };

function occurrencesInRow(row: Row, rowIdx: number, fields: ScanField[], requireSegmentStart = true): Occurrence[] {
  const found: Occurrence[] = [];
  for (const field of fields) {
    const tokens = labelTokens(field.label);
    for (const span of findLabel(row, tokens)) {
      if (requireSegmentStart && !startsSegment(row, span.start)) continue;
      found.push({ field, rowIdx, start: span.start, end: span.end, strong: strongAfter(row, span.end), fuzzy: span.fuzzy, labelLength: tokens.length });
    }
  }
  // When labels overlap ("Total" inside "Total Amount"), the longer label wins.
  found.sort((a, b) => b.labelLength - a.labelLength || a.start - b.start);
  const kept: Occurrence[] = [];
  for (const occurrence of found) {
    if (!kept.some((other) => occurrence.start <= other.end && other.start <= occurrence.end)) kept.push(occurrence);
  }
  return kept.sort((a, b) => a.start - b.start);
}

// ---------- reading values ----------

function joinWords(words: ScanWord[]): string {
  return words.map((word) => word.text).join(" ");
}

function lowestConfidence(words: ScanWord[]): number | undefined {
  const values = words.map((word) => word.conf).filter((value): value is number => typeof value === "number");
  return values.length > 0 ? Math.min(...values) : undefined;
}

/** The words to the right of the label on the same row, stopping at the next label or a wide gap. */
function sameRowValue(row: Row, occurrence: Occurrence, cutStarts: number[]): ScanWord[] {
  let i = occurrence.end + 1;
  while (i < row.words.length && (wordNorm(row.words[i]) === "" || /^[:=\-–—|]+$/.test(row.words[i].text))) i++;
  const cut = cutStarts.filter((start) => start >= i).sort((a, b) => a - b)[0] ?? row.words.length;
  const words: ScanWord[] = [];
  for (let k = i; k < cut; k++) {
    if (words.length > 0 && gapBefore(row, k) > row.height * 4) break;
    const word = row.words[k];
    words.push(words.length === 0 ? { ...word, text: word.text.replace(/^[:=]+/, "") } : word);
  }
  return words.filter((word) => word.text !== "");
}

type Context = { rows: Row[]; tableRows: Set<number>; allFields: ScanField[]; labelStarts: Map<number, Set<number>> };

function labelStartsOf(ctx: Context, rowIdx: number): Set<number> {
  let starts = ctx.labelStarts.get(rowIdx);
  if (!starts) {
    starts = new Set(occurrencesInRow(ctx.rows[rowIdx], rowIdx, ctx.allFields).map((occurrence) => occurrence.start));
    ctx.labelStarts.set(rowIdx, starts);
  }
  return starts;
}

/** Label above, value below: take the cell of the next row that sits under the label. */
function nextRowValue(ctx: Context, rowIdx: number, occurrence: Occurrence): ScanWord[] {
  const row = ctx.rows[rowIdx];
  const next = ctx.rows[rowIdx + 1];
  if (!next || next.page !== row.page || ctx.tableRows.has(rowIdx + 1)) return [];
  if (next.top - row.bottom > row.height * 2) return [];
  const from = row.words[occurrence.start].x0 - row.height;
  const to = row.words[occurrence.end].x1 + row.height;
  let best: Cell | null = null;
  let bestOverlap = 0;
  for (const cell of cellsOf(next)) {
    const overlap = Math.min(cell.x1, to) - Math.max(cell.x0, from);
    if (overlap > bestOverlap) {
      best = cell;
      bestOverlap = overlap;
    }
  }
  if (!best || labelStartsOf(ctx, rowIdx + 1).has(best.start)) return [];
  return best.words;
}

/** For long text: keep adding the lines underneath while they clearly belong to the same paragraph. */
function extendLongText(ctx: Context, rowIdx: number, words: ScanWord[], leftLimit: number): { text: string; rowsUsed: number } {
  let text = joinWords(words);
  if (words.length === 0) return { text, rowsUsed: 0 };
  let rowsUsed = 0;
  let current = ctx.rows[rowIdx];
  for (let k = rowIdx + 1; k < ctx.rows.length && rowsUsed < 8; k++) {
    const next = ctx.rows[k];
    if (next.page !== current.page || ctx.tableRows.has(k)) break;
    if (next.top - current.bottom > current.height * 0.9) break;
    if (labelStartsOf(ctx, k).size > 0) break;
    if (next.words[0].x0 < leftLimit - current.height * 2) break;
    text += ` ${next.text}`;
    current = next;
    rowsUsed++;
  }
  return { text, rowsUsed };
}

function failure(field: ScanField, note: string, sourceText?: string, page?: number): Suggestion {
  return { confidence: "none", note, sourceText, page };
}

function readHeaderField(ctx: Context, field: ScanField, occurrencesByRow: Map<number, Occurrence[]>, ownOccurrences: Occurrence[]): Suggestion {
  if (field.dataType === "BOOLEAN") return failure(field, "Yes/No fields are not read automatically. Please answer this one yourself.");
  if (labelTokens(field.label).length === 0) return failure(field, "This field's name has no letters or digits to look for.");

  // No label at the start of a cell anywhere: as a last resort accept "Label:" in the middle of a line
  // (two fields written next to each other). It is always marked "check".
  let candidates = ownOccurrences;
  if (candidates.length === 0) {
    candidates = [];
    ctx.rows.forEach((row, rowIdx) => {
      if (ctx.tableRows.has(rowIdx)) return;
      for (const occurrence of occurrencesInRow(row, rowIdx, ctx.allFields, false)) {
        if (occurrence.field.id === field.id && /[:=]$/.test(row.words[occurrence.end].text)) candidates.push({ ...occurrence, loose: true });
      }
    });
  }
  if (candidates.length === 0) return failure(field, `"${field.label}" was not found in the document.`);

  const ordered = [...candidates.filter((o) => o.strong), ...candidates.filter((o) => !o.strong)];
  let firstFailure: Suggestion | null = null;

  for (const occurrence of ordered) {
    const row = ctx.rows[occurrence.rowIdx];
    const cutStarts = (occurrencesByRow.get(occurrence.rowIdx) ?? []).filter((other) => other !== occurrence && other.start > occurrence.end).map((other) => other.start);
    // A known label followed by a colon also ends this value, even without a gap before it.
    for (const relaxed of occurrencesInRow(row, occurrence.rowIdx, ctx.allFields, false)) {
      if (relaxed.start > occurrence.end && relaxed.field.id !== field.id && /[:=]$/.test(row.words[relaxed.end].text)) cutStarts.push(relaxed.start);
    }

    let words = sameRowValue(row, occurrence, cutStarts);
    let fromNextRow = false;
    let rowsUsed = 0;
    let rawText = joinWords(words);
    if (words.length === 0) {
      words = nextRowValue(ctx, occurrence.rowIdx, occurrence);
      fromNextRow = words.length > 0;
      rawText = joinWords(words);
    }
    if (field.dataType === "LONG_TEXT" && words.length > 0) {
      const extended = extendLongText(ctx, fromNextRow ? occurrence.rowIdx + 1 : occurrence.rowIdx, words, Math.min(row.words[occurrence.start].x0, words[0].x0));
      rawText = extended.text;
      rowsUsed = extended.rowsUsed;
    }
    if (words.length === 0) {
      firstFailure ??= failure(field, `"${field.label}" was found but nothing was written next to it.`, undefined, row.page);
      continue;
    }

    const parsed = parseForField(field, rawText);
    if (!parsed.ok) {
      firstFailure ??= failure(field, parsed.note ?? `The text next to "${field.label}" could not be read as ${field.dataType.toLowerCase().replace("_", " ")}.`, rawText, row.page);
      continue;
    }

    const notes: string[] = [];
    let confidence: Confidence = "high";
    if (!occurrence.strong) {
      confidence = "check";
      notes.push("There is no colon or gap after the label, so this value is less certain.");
    }
    if (occurrence.fuzzy) {
      confidence = "check";
      notes.push("The label was matched approximately.");
    }
    if (occurrence.loose) {
      confidence = "check";
      notes.push("The label appears in the middle of a line, so please check that this is the right value.");
    }
    if (fromNextRow) {
      confidence = "check";
      notes.push("The value was taken from the line under the label.");
    }
    if (rowsUsed > 0) {
      confidence = "check";
      notes.push("Several lines were joined. Please check where the text should end.");
    }
    const low = lowestConfidence(words);
    if (low !== undefined && low < 80) {
      confidence = "check";
      notes.push("The scan of this text was not clear. Please check it.");
    }
    if (parsed.check) confidence = "check";
    if (parsed.note) notes.push(parsed.note);

    return { value: parsed.value, confidence, sourceText: rawText, page: row.page, note: notes.join(" ") || undefined, alternatives: parsed.alternatives };
  }

  return firstFailure ?? failure(field, `"${field.label}" was found but no value could be read.`);
}

// ---------- line item tables ----------

type Column = { field: ScanField | null; x0: number; x1: number };
type TableHit = { headerRowIdx: number; columns: Column[]; matched: number };

function findTableHeader(row: Row, fields: ScanField[]): { columns: Column[]; matched: number } | null {
  const used = new Set<number>();
  const columns: Column[] = [];
  const byLength = [...fields].sort((a, b) => labelTokens(b.label).length - labelTokens(a.label).length);
  for (const field of byLength) {
    const tokens = labelTokens(field.label);
    for (const span of findLabel(row, tokens)) {
      let clash = false;
      for (let i = span.start; i <= span.end; i++) if (used.has(i)) clash = true;
      if (clash) continue;
      for (let i = span.start; i <= span.end; i++) used.add(i);
      columns.push({ field, x0: row.words[span.start].x0, x1: row.words[span.end].x1 });
      break;
    }
  }
  const matched = columns.length;
  // Header words that matched no field still mark a column, so their text is not given to a neighbour.
  let run: ScanWord[] = [];
  const flush = () => {
    if (run.length > 0) columns.push({ field: null, x0: run[0].x0, x1: run[run.length - 1].x1 });
    run = [];
  };
  row.words.forEach((word, index) => {
    if (used.has(index)) return flush();
    if (run.length > 0 && word.x0 - run[run.length - 1].x1 > row.cellGap) flush();
    run.push(word);
  });
  flush();
  columns.sort((a, b) => a.x0 - b.x0);
  return { columns, matched };
}

function bestTableOnPage(rows: Row[], page: number, fields: ScanField[]): TableHit | null {
  const need = fields.length === 1 ? 1 : Math.max(2, Math.ceil(fields.length / 2));
  let best: TableHit | null = null;
  rows.forEach((row, rowIdx) => {
    if (row.page !== page) return;
    const header = findTableHeader(row, fields);
    if (header && header.matched >= need && (!best || header.matched > best.matched)) best = { headerRowIdx: rowIdx, ...header };
  });
  return best;
}

function isStopRow(ctx: Context, rowIdx: number): boolean {
  const row = ctx.rows[rowIdx];
  const first = row.words.map((word) => word.text).join(" ").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (STOP_WORDS.some((stop) => first === stop || first.startsWith(`${stop} `))) return true;
  return labelStartsOf(ctx, rowIdx).has(0);
}

/** Gives each cell of a body row to the column it sits under; a cell that spans two columns is split word by word. */
function assignToColumns(row: Row, columns: Column[]): ScanWord[][] {
  const result: ScanWord[][] = columns.map(() => []);
  const overlap = (cell: { x0: number; x1: number }, column: Column) => Math.min(cell.x1, column.x1) - Math.max(cell.x0, column.x0);
  const nearest = (centre: number) => {
    let best = 0;
    columns.forEach((column, index) => {
      if (Math.abs((column.x0 + column.x1) / 2 - centre) < Math.abs((columns[best].x0 + columns[best].x1) / 2 - centre)) best = index;
    });
    return best;
  };

  for (const cell of cellsOf(row)) {
    const overlapping = columns.map((column, index) => ({ index, size: overlap(cell, column) })).filter((item) => item.size > 0);
    if (overlapping.length === 0) {
      result[nearest((cell.x0 + cell.x1) / 2)].push(...cell.words);
    } else if (overlapping.length === 1) {
      result[overlapping[0].index].push(...cell.words);
    } else {
      let current = overlapping[0].index;
      for (const word of cell.words) {
        const centre = (word.x0 + word.x1) / 2;
        const inside = columns.findIndex((column) => centre >= column.x0 && centre <= column.x1);
        if (inside >= 0) current = inside;
        result[current].push(word);
      }
    }
  }
  return result;
}

function readLines(ctx: Context, table: TableHit, lineFields: ScanField[], notes: string[]): { lines: LineSuggestion[]; endRowIdx: number } {
  const lines: LineSuggestion[] = [];
  const page = ctx.rows[table.headerRowIdx].page;
  const typedColumns = table.columns.filter((column) => column.field && column.field.dataType !== "TEXT" && column.field.dataType !== "LONG_TEXT" && column.field.dataType !== "BOOLEAN");
  const cells: Array<Record<string, string>> = [];
  const pages: Array<Record<string, number>> = [];
  const lows: Array<Record<string, number | undefined>> = [];

  let previousRow: Row | null = null;
  let endRowIdx = table.headerRowIdx;

  for (let rowIdx = table.headerRowIdx + 1; rowIdx < ctx.rows.length; rowIdx++) {
    const row = ctx.rows[rowIdx];
    if (row.page !== page) break;
    const reference: Row = previousRow ?? ctx.rows[table.headerRowIdx];
    if (row.top - reference.bottom > row.height * 3) break;
    if (isStopRow(ctx, rowIdx)) break;
    endRowIdx = rowIdx;

    const perColumn = assignToColumns(row, table.columns);
    const texts: Record<string, string> = {};
    const confs: Record<string, number | undefined> = {};
    table.columns.forEach((column, index) => {
      if (column.field && perColumn[index].length > 0) {
        texts[column.field.fieldKey] = joinWords(perColumn[index]);
        confs[column.field.fieldKey] = lowestConfidence(perColumn[index]);
      }
    });
    if (Object.keys(texts).length === 0) {
      previousRow = row;
      continue;
    }

    const hasTypedContent = typedColumns.some((column) => texts[column.field!.fieldKey] !== undefined);
    const previous = cells[cells.length - 1];
    if (!hasTypedContent && typedColumns.length > 0 && previous && previousRow && row.top - previousRow.bottom <= row.height) {
      // Only text, no figures: the description of the previous line continues here.
      for (const [key, text] of Object.entries(texts)) previous[key] = previous[key] ? `${previous[key]} ${text}` : text;
      notes.push(`A line that continued onto a second row was joined to line ${cells.length}. Please check it.`);
      previousRow = row;
      continue;
    }

    cells.push(texts);
    pages.push(Object.fromEntries(Object.keys(texts).map((key) => [key, row.page])));
    lows.push(confs);
    previousRow = row;
    if (cells.length >= MAX_LINES) {
      notes.push(`Only the first ${MAX_LINES} lines were read.`);
      break;
    }
  }

  cells.forEach((texts, lineIndex) => {
    const values: ScanValues = {};
    const meta: Record<string, Suggestion> = {};
    for (const field of lineFields) {
      if (field.dataType === "BOOLEAN") {
        meta[field.fieldKey] = failure(field, "Yes/No fields are not read automatically.");
        continue;
      }
      const raw = texts[field.fieldKey];
      if (raw === undefined) {
        meta[field.fieldKey] = failure(field, table.columns.some((column) => column.field?.id === field.id) ? "This cell is empty in the document." : `No column named "${field.label}" was found in the table.`);
        continue;
      }
      const parsed = parseForField(field, raw);
      if (!parsed.ok) {
        meta[field.fieldKey] = failure(field, parsed.note ?? "Could not be read.", raw, pages[lineIndex][field.fieldKey]);
        continue;
      }
      const noteParts: string[] = [];
      let confidence: Confidence = "high";
      const low = lows[lineIndex][field.fieldKey];
      if (low !== undefined && low < 80) {
        confidence = "check";
        noteParts.push("The scan of this text was not clear. Please check it.");
      }
      if (parsed.check) confidence = "check";
      if (parsed.note) noteParts.push(parsed.note);
      meta[field.fieldKey] = { value: parsed.value, confidence, sourceText: raw, page: pages[lineIndex][field.fieldKey], note: noteParts.join(" ") || undefined, alternatives: parsed.alternatives };
      if (parsed.value !== undefined) values[field.fieldKey] = parsed.value;
    }
    lines.push({ values, meta });
  });

  return { lines, endRowIdx };
}

// ---------- entry point ----------

export function matchDocument(pages: ScanPage[], fields: ScanField[], supportsLineItems: boolean): DocumentSuggestions {
  const headerFields = fields.filter((field) => field.fieldGroup === "HEADER");
  const lineFields = supportsLineItems ? fields.filter((field) => field.fieldGroup === "LINE_ITEM") : [];
  const notes: string[] = [];
  const rows = buildRows(pages);

  if (rows.length === 0) {
    notes.push("No readable text was found in this file. Please enter the values yourself.");
    return {
      header: Object.fromEntries(headerFields.map((field) => [field.fieldKey, failure(field, "Nothing could be read from the file.")])),
      lines: [],
      notes,
    };
  }

  const ctx: Context = { rows, tableRows: new Set(), allFields: headerFields, labelStarts: new Map() };

  // 1. Item tables first, so their rows are not mistaken for header values.
  let lines: LineSuggestion[] = [];
  if (lineFields.length > 0) {
    const pageNumbers = [...new Set(rows.map((row) => row.page))];
    let tableFound = false;
    for (const pageNumber of pageNumbers) {
      const table = bestTableOnPage(rows, pageNumber, lineFields);
      if (!table) {
        if (tableFound) notes.push(`Page ${pageNumber} has no recognised column headings, so lines on that page were not read.`);
        continue;
      }
      tableFound = true;
      const result = readLines(ctx, table, lineFields, notes);
      for (let i = table.headerRowIdx; i <= result.endRowIdx; i++) ctx.tableRows.add(i);
      lines = lines.concat(result.lines);
    }
    if (!tableFound) notes.push("No table with matching column headings was found, so no lines were read.");
    else if (lines.length === 0) notes.push("A table was found but no lines could be read from it.");
  }

  // 2. Header fields.
  const occurrencesByRow = new Map<number, Occurrence[]>();
  const byField = new Map<string, Occurrence[]>();
  rows.forEach((row, rowIdx) => {
    if (ctx.tableRows.has(rowIdx)) return;
    const found = occurrencesInRow(row, rowIdx, headerFields);
    occurrencesByRow.set(rowIdx, found);
    for (const occurrence of found) byField.set(occurrence.field.id, [...(byField.get(occurrence.field.id) ?? []), occurrence]);
  });

  const header: Record<string, Suggestion> = {};
  for (const field of headerFields) header[field.fieldKey] = readHeaderField(ctx, field, occurrencesByRow, byField.get(field.id) ?? []);

  return { header, lines: lines.slice(0, MAX_LINES), notes: [...new Set(notes)] };
}
