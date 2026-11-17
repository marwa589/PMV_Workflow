"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { FieldInput, type FieldInputField, type FieldValue, type FieldValues } from "@/components/upload-field-input";
import type { ConfirmedValues, FileScanState } from "@/lib/document-scan/use-document-scan";
import type { DocumentSuggestions, Suggestion } from "@/lib/document-scan/types";

// The page where the person checks what was read from each file, corrects it, and confirms it.
// Nothing is saved or filled in until "Confirm" is pressed.

export type ReviewField = FieldInputField & { id: string; label: string; isRequired: boolean };

type LineEdit = { uid: number; values: FieldValues; meta?: Record<string, Suggestion> };
type Edit = { header: FieldValues; lines: LineEdit[] };

type Props = {
  files: File[];
  keys: string[];
  scans: Record<string, FileScanState>;
  suggestions: Array<DocumentSuggestions | null>;
  confirmedFor: (key: string) => ConfirmedValues | undefined;
  headerFields: ReviewField[];
  lineFields: ReviewField[];
  showLineItems: boolean;
  typeLabel: string;
  onConfirm: (values: Record<string, ConfirmedValues>) => void;
  onCancel: () => void;
};

const isBlank = (value: FieldValue | undefined) => value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
const sameValue = (a: FieldValue | undefined, b: FieldValue | undefined) => JSON.stringify(a ?? "") === JSON.stringify(b ?? "");

let lineCounter = 0;
const nextUid = () => ++lineCounter;

function formatDate(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function Badge({ suggestion, edited }: { suggestion: Suggestion | undefined; edited: boolean }) {
  if (edited) return <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-800">Edited by you</span>;
  if (!suggestion || suggestion.confidence === "none") return <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">Not found</span>;
  if (suggestion.confidence === "high") return <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">Read from document</span>;
  return <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">Please check</span>;
}

function SourceInfo({ suggestion, pageCount, compact = false }: { suggestion: Suggestion | undefined; pageCount: number; compact?: boolean }) {
  if (!suggestion) return null;
  const showNote = suggestion.note && (!compact || suggestion.confidence === "check" || suggestion.sourceText);
  return (
    <>
      {suggestion.sourceText ? (
        <p className="mt-1 break-words text-xs text-slate-500">
          In the document: &ldquo;{suggestion.sourceText}&rdquo;{pageCount > 1 && suggestion.page ? ` (page ${suggestion.page})` : ""}
        </p>
      ) : null}
      {showNote ? <p className={`mt-1 text-xs ${suggestion.confidence === "check" ? "text-amber-800" : "text-slate-500"}`}>{suggestion.note}</p> : null}
    </>
  );
}

function AlternativeDates({ suggestion, current, onPick }: { suggestion: Suggestion | undefined; current: FieldValue | undefined; onPick: (value: string) => void }) {
  if (!suggestion?.alternatives || suggestion.alternatives.length === 0 || !isBlank(current)) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-slate-600">Which one is right?</span>
      {suggestion.alternatives.map((option) => (
        <button key={option} type="button" onClick={() => onPick(option)} className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 font-medium text-amber-900 hover:bg-amber-100">
          {formatDate(option)}
        </button>
      ))}
    </div>
  );
}

function initialEdit(suggestion: DocumentSuggestions | null, confirmed: ConfirmedValues | undefined, headerFields: ReviewField[]): Edit {
  if (confirmed) {
    return { header: { ...confirmed.header }, lines: confirmed.lines.map((values) => ({ uid: nextUid(), values: { ...values } })) };
  }
  const header: FieldValues = {};
  if (suggestion) {
    for (const field of headerFields) {
      const value = suggestion.header[field.fieldKey]?.value;
      if (value !== undefined) header[field.fieldKey] = value;
    }
  }
  const lines = (suggestion?.lines ?? []).map((line) => ({ uid: nextUid(), values: { ...line.values } as FieldValues, meta: line.meta }));
  return { header, lines };
}

export default function DocumentScanReview({ files, keys, scans, suggestions, confirmedFor, headerFields, lineFields, showLineItems, typeLabel, onConfirm, onCancel }: Props) {
  const [edits, setEdits] = useState<Record<string, Edit>>(() =>
    Object.fromEntries(keys.map((key, index) => [key, initialEdit(suggestions[index] ?? null, confirmedFor(key), headerFields)])),
  );
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const key = keys[active] ?? keys[0];
  const file = files[active] ?? files[0];
  const scan = scans[key];
  const suggestion = suggestions[active] ?? null;
  const edit = edits[key] ?? { header: {}, lines: [] };
  const pageCount = scan?.pages?.length ?? 0;
  const usedOcr = Boolean(scan?.pages?.some((page) => page.source === "ocr"));

  const patch = (change: (current: Edit) => Edit) => setEdits((current) => ({ ...current, [key]: change(current[key] ?? { header: {}, lines: [] }) }));
  const setHeader = (fieldKey: string, value: FieldValue) => patch((current) => ({ ...current, header: { ...current.header, [fieldKey]: value } }));
  const setLine = (uid: number, fieldKey: string, value: FieldValue) =>
    patch((current) => ({ ...current, lines: current.lines.map((line) => (line.uid === uid ? { ...line, values: { ...line.values, [fieldKey]: value } } : line)) }));

  function attention(index: number): number {
    const k = keys[index];
    const sug = suggestions[index];
    const current = edits[k];
    if (!current) return 0;
    let count = 0;
    for (const field of headerFields) {
      const s = sug?.header[field.fieldKey];
      const edited = !sameValue(current.header[field.fieldKey], s?.value);
      if (!edited && s?.confidence === "check") count++;
      if (field.isRequired && field.dataType !== "BOOLEAN" && isBlank(current.header[field.fieldKey])) count++;
    }
    return count;
  }

  function confirm() {
    const result: Record<string, ConfirmedValues> = {};
    for (const [index, k] of keys.entries()) {
      const current = edits[k] ?? { header: {}, lines: [] };
      const name = files[index]?.name ?? "File";
      const prefix = files.length > 1 ? `${name}: ` : "";

      for (const field of headerFields) {
        if (field.isRequired && field.dataType !== "BOOLEAN" && isBlank(current.header[field.fieldKey])) {
          setActive(index);
          setError(`${prefix}${field.label} is required.`);
          return;
        }
      }
      const lines = current.lines.filter((line) => lineFields.some((field) => !isBlank(line.values[field.fieldKey])));
      for (const [lineIndex, line] of lines.entries()) {
        for (const field of lineFields) {
          if (field.isRequired && field.dataType !== "BOOLEAN" && isBlank(line.values[field.fieldKey])) {
            setActive(index);
            setError(`${prefix}Line ${lineIndex + 1}: ${field.label} is required.`);
            return;
          }
        }
      }
      result[k] = { header: current.header, lines: showLineItems ? lines.map((line) => line.values) : [] };
    }
    setError(null);
    onConfirm(result);
  }

  const fileProblem =
    scan?.status === "failed"
      ? `This file could not be read automatically (${scan.error ?? "unknown problem"}). Please enter its values yourself.`
      : scan?.status === "unsupported"
        ? "Word and Excel files cannot be read automatically. Only PDF and picture files can. Please enter the values for this file yourself."
        : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="scan-review-title">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-slate-200 p-5">
          <h2 id="scan-review-title" className="text-lg font-semibold text-slate-900">Check the values read from your {files.length > 1 ? "files" : "file"}</h2>
          <p className="mt-1 text-sm text-slate-600">
            These are the {typeLabel} fields, filled in from what was found in the document. Nothing is used until you confirm. Correct anything that is wrong or empty, then press Confirm.
          </p>
        </div>

        <div className="space-y-5 overflow-y-auto p-5">
          {files.length > 1 ? (
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Files">
              {files.map((item, index) => {
                const count = attention(index);
                return (
                  <button
                    key={keys[index]}
                    type="button"
                    role="tab"
                    aria-selected={index === active}
                    onClick={() => setActive(index)}
                    className={`max-w-[16rem] truncate rounded-lg border px-3 py-1.5 text-sm ${index === active ? "border-cyan-500 bg-cyan-50 font-medium text-cyan-900" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                  >
                    {item.name}
                    {count > 0 ? <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">{count} to check</span> : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          <p className="text-sm text-slate-700">
            <span className="font-medium">{file?.name}</span>
            {files.length > 1 ? <span className="text-slate-500"> &mdash; this file becomes its own document with the values below.</span> : null}
          </p>

          {fileProblem ? (
            <div className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{fileProblem}</p>
            </div>
          ) : null}
          {usedOcr ? (
            <div className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>Some pages of this file are scans and were read with OCR. Scanned text can contain misread letters and digits, so please check every value against the document.</p>
            </div>
          ) : null}
          {suggestion && suggestion.notes.length > 0 ? (
            <ul className="space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              {suggestion.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}

          {headerFields.length > 0 ? (
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              {headerFields.map((field) => {
                const s = suggestion?.header[field.fieldKey];
                const current = edit.header[field.fieldKey];
                const edited = Boolean(suggestion) && !sameValue(current, s?.value) && !(isBlank(current) && isBlank(s?.value));
                const needsLook = !edited && s?.confidence === "check";
                return (
                  <div key={field.id} className={`rounded-xl border bg-white p-3 ${needsLook ? "border-amber-300" : "border-slate-200"}`}>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <label htmlFor={`scan-${active}-HEADER-${field.fieldKey}`} className="text-sm font-medium text-slate-700">
                        {field.label} {field.isRequired ? <span className="text-rose-600">*</span> : <span className="font-normal text-slate-500">(optional)</span>}
                      </label>
                      <Badge suggestion={s} edited={edited} />
                    </div>
                    <FieldInput field={field} idPrefix={`scan-${active}`} value={current} onChange={(next) => setHeader(field.fieldKey, next)} />
                    <AlternativeDates suggestion={s} current={current} onPick={(value) => setHeader(field.fieldKey, value)} />
                    <SourceInfo suggestion={s} pageCount={pageCount} />
                  </div>
                );
              })}
            </div>
          ) : null}

          {showLineItems ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700">Items ({edit.lines.length})</p>
                <button
                  type="button"
                  onClick={() => patch((current) => ({ ...current, lines: [...current.lines, { uid: nextUid(), values: {} }] }))}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add line
                </button>
              </div>
              {edit.lines.length === 0 ? <p className="text-xs text-slate-500">No lines were read. Add them yourself if this document has items.</p> : null}
              <div className="space-y-3">
                {edit.lines.map((line, index) => (
                  <div key={line.uid} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                      <span>Line {index + 1}</span>
                      <button type="button" onClick={() => patch((current) => ({ ...current, lines: current.lines.filter((item) => item.uid !== line.uid) }))} className="inline-flex items-center gap-1 text-slate-600 hover:text-rose-600">
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {lineFields.map((field) => {
                        const s = line.meta?.[field.fieldKey];
                        const current = line.values[field.fieldKey];
                        const edited = Boolean(line.meta) && !sameValue(current, s?.value) && !(isBlank(current) && isBlank(s?.value));
                        const needsLook = !edited && s?.confidence === "check";
                        return (
                          <div key={field.id} className={`rounded-lg ${needsLook ? "ring-1 ring-amber-300" : ""}`}>
                            <div className="mb-1 flex items-start justify-between gap-2">
                              <label htmlFor={`scan-${active}-LINE_ITEM-${field.fieldKey}`} className="text-xs font-medium text-slate-600">
                                {field.label} {field.isRequired ? <span className="text-rose-600">*</span> : null}
                              </label>
                              {line.meta ? <Badge suggestion={s} edited={edited} /> : null}
                            </div>
                            <FieldInput field={field} compact idPrefix={`scan-${active}-${line.uid}`} value={current} onChange={(next) => setLine(line.uid, field.fieldKey, next)} />
                            <AlternativeDates suggestion={s} current={current} onPick={(value) => setLine(line.uid, field.fieldKey, value)} />
                            <SourceInfo suggestion={s} pageCount={pageCount} compact />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className={`text-sm ${error ? "text-rose-700" : "text-slate-500"}`} role={error ? "alert" : undefined}>
            {error ?? "Closing this page without confirming keeps the fields empty, so you can fill them in by hand."}
          </p>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Close without using
            </button>
            <button type="button" onClick={confirm} className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700">
              {files.length > 1 ? "Confirm all files" : "Confirm values"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
