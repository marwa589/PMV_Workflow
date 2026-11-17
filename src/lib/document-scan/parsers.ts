import type { ScanField, ScanValue } from "./types";

// Turns the text found in a document into the value a field accepts.
// Rule: when the text can be read in more than one way, nothing is guessed. The value is left empty and the
// possible readings are handed back so the person can choose.

export type ParseResult = {
  ok: boolean;
  value?: ScanValue;
  note?: string;
  alternatives?: string[];
  /** The value was read but something about it deserves a second look. */
  check?: boolean;
};

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function cleanText(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/^[\s:;=\-–—|#.]+/, "")
    .replace(/[\s:;=|]+$/, "")
    .trim();
}

// ---------- numbers ----------

export function parseNumber(raw: string): ParseResult {
  const text = raw.trim();
  if (!text) return { ok: false };

  const tokens = text.match(/\d[\d.,]*\d|\d/g) ?? [];
  if (tokens.length === 0) return { ok: false, note: `"${text}" has no number in it.` };
  if (tokens.length > 1) return { ok: false, note: `"${text}" has more than one number, so none was picked.` };

  const token = tokens[0] as string;
  const leftover = text.replace(token, " ").replace(/[()\-+%$€£]/g, " ").replace(/\s+/g, " ").trim();
  if (leftover.length > 8) return { ok: false, note: `"${text}" does not look like a plain number.` };

  const negative = /^\(.*\)$/.test(text) || /^-/.test(text) || /-$/.test(text);
  let digits = token;
  const hasComma = digits.includes(",");
  const hasDot = digits.includes(".");

  if (hasComma && hasDot) {
    const decimalIsDot = digits.lastIndexOf(".") > digits.lastIndexOf(",");
    digits = decimalIsDot ? digits.replace(/,/g, "") : digits.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    if (/^\d{1,3}(,\d{3})+$/.test(digits)) digits = digits.replace(/,/g, "");
    else return { ok: false, note: `"${token}" could mean a decimal comma or a thousands comma, so no value was picked.` };
  } else if (hasDot) {
    if ((digits.match(/\./g) ?? []).length > 1) {
      if (/^\d{1,3}(\.\d{3})+$/.test(digits)) digits = digits.replace(/\./g, "");
      else return { ok: false, note: `"${token}" is not a clear number.` };
    }
  }

  if (!/^\d+(\.\d+)?$/.test(digits)) return { ok: false, note: `"${token}" is not a clear number.` };
  const value = (negative ? "-" : "") + digits;
  const notes: string[] = [];
  if (leftover) notes.push(`Text next to the number was ignored: "${leftover}".`);
  if (/%/.test(text)) notes.push("A percent sign was ignored.");
  return { ok: true, value, check: notes.length > 0, note: notes.join(" ") || undefined };
}

// ---------- dates ----------

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2200) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseDate(raw: string): ParseResult {
  const text = raw.trim();
  if (!text) return { ok: false };
  let twoDigitYear = false;
  const fullYear = (value: string) => {
    if (value.length === 4) return Number(value);
    twoDigitYear = true;
    return 2000 + Number(value);
  };
  const done = (value: string | null): ParseResult =>
    value
      ? { ok: true, value, check: twoDigitYear, note: twoDigitYear ? "A two-digit year was read as 20xx. Please check it." : undefined }
      : { ok: false, note: `"${text}" is not a valid date.` };

  // 2025-04-03 (year first, so it can only be read one way)
  let m = text.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) return done(iso(Number(m[1]), Number(m[2]), Number(m[3])));

  // 3 Apr 2025 / 03-Apr-25
  m = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s\-./]+([A-Za-z]{3,9})\.?,?[\s\-./]+(\d{4}|\d{2})\b/);
  if (m && MONTHS[m[2].toLowerCase()]) return done(iso(fullYear(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1])));

  // April 3, 2025
  m = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (m && MONTHS[m[1].toLowerCase()]) return done(iso(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2])));

  // 03/04/2025 - day first or month first?
  m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = fullYear(m[3]);
    const dayFirst = iso(year, b, a);
    const monthFirst = iso(year, a, b);
    if (a === b) return done(dayFirst);
    if (a > 12) return done(dayFirst);
    if (b > 12) return done(monthFirst);
    if (dayFirst && monthFirst) {
      return {
        ok: true,
        value: undefined,
        alternatives: [dayFirst, monthFirst],
        note: `"${m[0]}" can be read as day/month or month/day. Please choose.`,
        check: true,
      };
    }
    return done(dayFirst ?? monthFirst);
  }

  return { ok: false, note: `"${text}" was not recognised as a date.` };
}

// ---------- choices ----------

export function matchOption(raw: string, options: string[]): string | null {
  const wanted = normalizeText(raw);
  if (!wanted) return null;
  return options.find((option) => normalizeText(option) === wanted) ?? null;
}

export function parseSelect(raw: string, options: string[]): ParseResult {
  const found = matchOption(raw, options);
  if (found) return { ok: true, value: found };
  return { ok: false, note: `"${raw.trim()}" is not one of the allowed choices.` };
}

export function parseMultiSelect(raw: string, options: string[]): ParseResult {
  const parts = raw.split(/[,;/&]|\band\b/i).map((part) => part.trim()).filter(Boolean);
  const matched: string[] = [];
  const unmatched: string[] = [];
  for (const part of parts) {
    const option = matchOption(part, options);
    if (option) {
      if (!matched.includes(option)) matched.push(option);
    } else unmatched.push(part);
  }
  if (matched.length === 0) return { ok: false, note: `"${raw.trim()}" does not match any allowed choice.` };
  return {
    ok: true,
    value: matched,
    check: unmatched.length > 0,
    note: unmatched.length > 0 ? `These were not recognised and were left out: ${unmatched.join(", ")}.` : undefined,
  };
}

// ---------- one entry point ----------

const MAX_TEXT = 500;
const MAX_LONG_TEXT = 10000;

/** Turns text found in the document into a value for `field`. */
export function parseForField(field: ScanField, raw: string): ParseResult {
  const text = cleanText(raw);
  if (!text) return { ok: false };
  switch (field.dataType) {
    case "NUMBER":
      return parseNumber(text);
    case "DATE":
      return parseDate(text);
    case "SELECT":
      return parseSelect(text, field.options);
    case "MULTI_SELECT":
      return parseMultiSelect(text, field.options);
    case "BOOLEAN":
      return { ok: false };
    case "LONG_TEXT":
      return text.length > MAX_LONG_TEXT ? { ok: false, note: "The text found is too long for this field." } : { ok: true, value: text };
    default:
      return text.length > MAX_TEXT ? { ok: false, note: `The text found is longer than ${MAX_TEXT} characters.` } : { ok: true, value: text };
  }
}
