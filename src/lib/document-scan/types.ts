// Shared shapes for the document scanner. Nothing here depends on React, the browser or the server.

export type ScanWord = {
  text: string;
  x0: number;
  x1: number;
  /** Top and bottom of the word, measured downwards from the top of the page. */
  top: number;
  bottom: number;
  /** OCR confidence 0-100 (only set for words read by OCR). */
  conf?: number;
};

export type ScanPage = {
  pageNumber: number;
  /** "text" = the PDF's own text layer; "ocr" = read from a picture of the page. */
  source: "text" | "ocr";
  words: ScanWord[];
};

export type ScanDataType = "TEXT" | "LONG_TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT" | "MULTI_SELECT";

/** The part of a field definition the scanner needs (UploadField in the form fits this). */
export type ScanField = {
  id: string;
  fieldGroup: "HEADER" | "LINE_ITEM";
  fieldKey: string;
  label: string;
  dataType: ScanDataType;
  isRequired: boolean;
  options: string[];
};

export type ScanValue = string | boolean | string[];
export type ScanValues = Record<string, ScanValue>;

/**
 * high  = the label was found with a clear value next to it
 * check = a value was found but something is uncertain (explained in `note`)
 * none  = nothing usable was found
 */
export type Confidence = "high" | "check" | "none";

export type Suggestion = {
  value?: ScanValue;
  confidence: Confidence;
  /** The text as it appears in the document, shown next to the value so the person can compare. */
  sourceText?: string;
  page?: number;
  note?: string;
  /** For an ambiguous date: the readings the person can pick from (YYYY-MM-DD). The value is left empty until one is picked. */
  alternatives?: string[];
};

export type LineSuggestion = {
  values: ScanValues;
  meta: Record<string, Suggestion>;
};

export type DocumentSuggestions = {
  header: Record<string, Suggestion>;
  lines: LineSuggestion[];
  /** Messages about the document as a whole (nothing readable, pages skipped, ...). */
  notes: string[];
};
