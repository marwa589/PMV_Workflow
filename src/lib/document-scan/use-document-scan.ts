"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { canScan, extractPages, type ScanProgress } from "./extract";
import { matchDocument } from "./match";
import type { DocumentSuggestions, ScanField, ScanPage, ScanValues } from "./types";

export type FileScanState = {
  status: "waiting" | "scanning" | "done" | "failed" | "unsupported";
  progress?: ScanProgress;
  pages?: ScanPage[];
  skippedPages?: number;
  error?: string;
};

/** What the person confirmed for one file. Used for that file only: every file is its own document. */
export type ConfirmedValues = { header: ScanValues; lines: ScanValues[] };

export function fileKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

const SETTLED: FileScanState["status"][] = ["done", "failed", "unsupported"];

type Options = {
  files: File[];
  /** The fields of the chosen type / sub type (header and line fields). */
  fields: ScanField[];
  /** Whether line items are part of this document type. */
  readLineItems: boolean;
  /** False until a type (and sub type, if it has any) is chosen and the type has fields to fill. */
  enabled: boolean;
  /** Changes whenever the type or sub type changes: confirmed values then no longer apply. */
  signature: string;
};

export function useDocumentScan({ files, fields, readLineItems, enabled, signature }: Options) {
  const [scans, setScans] = useState<Record<string, FileScanState>>({});
  const [confirmed, setConfirmed] = useState<Record<string, { signature: string; values: ConfirmedValues }>>({});
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const startedRef = useRef(new Set<string>());
  const autoOpenedRef = useRef<string | null>(null);
  const filesRef = useRef(files);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  filesRef.current = files;

  const keys = useMemo(() => files.map(fileKey), [files]);
  const sessionKey = `${signature}::${keys.join(",")}`;

  // 1. Read each new file once, one after the other (OCR is heavy), as soon as it is attached.
  useEffect(() => {
    if (!enabled) return;
    const pending = files.filter((file) => !startedRef.current.has(fileKey(file)));
    if (pending.length === 0) return;

    const initial: Record<string, FileScanState> = {};
    for (const file of pending) {
      startedRef.current.add(fileKey(file));
      initial[fileKey(file)] = { status: canScan(file) ? "waiting" : "unsupported" };
    }
    setScans((current) => ({ ...current, ...initial }));

    const update = (key: string, next: FileScanState) => setScans((current) => ({ ...current, [key]: next }));

    chainRef.current = chainRef.current.then(async () => {
      for (const file of pending) {
        const key = fileKey(file);
        if (!canScan(file)) continue;
        if (!filesRef.current.some((candidate) => fileKey(candidate) === key)) {
          update(key, { status: "failed", error: "The file was removed before it was read." });
          continue;
        }
        update(key, { status: "scanning", progress: { message: "Starting", fraction: null } });
        try {
          const result = await extractPages(file, (progress) => update(key, { status: "scanning", progress }));
          update(key, { status: "done", pages: result.pages, skippedPages: result.skippedPages });
        } catch (error) {
          update(key, { status: "failed", error: error instanceof Error ? error.message : "The file could not be read." });
        }
      }
    });
  }, [enabled, files]);

  // 2. Match the words of each file to the fields. Cheap, so it simply runs again when the type changes.
  const suggestions = useMemo<Array<DocumentSuggestions | null>>(
    () =>
      files.map((file) => {
        const scan = scans[fileKey(file)];
        if (!enabled || scan?.status !== "done" || !scan.pages) return null;
        const result = matchDocument(scan.pages, fields, readLineItems);
        if (scan.skippedPages) result.notes.push(`Only the first pages were read. ${scan.skippedPages} more page(s) were skipped.`);
        return result;
      }),
    [files, scans, fields, readLineItems, enabled],
  );

  const validConfirmed = useCallback(
    (key: string): ConfirmedValues | undefined => (confirmed[key]?.signature === signature ? confirmed[key]?.values : undefined),
    [confirmed, signature],
  );

  const allSettled = files.length > 0 && keys.every((key) => SETTLED.includes(scans[key]?.status ?? "waiting") && scans[key] !== undefined);
  const anyScanning = keys.some((key) => scans[key] !== undefined && !SETTLED.includes(scans[key].status));
  const allConfirmed = enabled && files.length > 0 && keys.every((key) => validConfirmed(key) !== undefined);

  // 3. When every file has been read, open the review page once for this set of files and type.
  useEffect(() => {
    if (!enabled || !allSettled || allConfirmed || reviewOpen) return;
    if (dismissedFor === sessionKey || autoOpenedRef.current === sessionKey) return;
    autoOpenedRef.current = sessionKey;
    setReviewOpen(true);
  }, [enabled, allSettled, allConfirmed, reviewOpen, dismissedFor, sessionKey]);

  const openReview = useCallback(() => setReviewOpen(true), []);

  /** Closing without confirming: the person fills the fields by hand, as before. */
  const closeReview = useCallback(() => {
    setReviewOpen(false);
    setDismissedFor(sessionKey);
  }, [sessionKey]);

  const confirm = useCallback(
    (values: Record<string, ConfirmedValues>) => {
      setConfirmed((current) => {
        const next = { ...current };
        for (const [key, value] of Object.entries(values)) next[key] = { signature, values: value };
        return next;
      });
      setReviewOpen(false);
    },
    [signature],
  );

  /** "Enter values manually instead": forget the confirmed values and show the normal fields again. */
  const discardConfirmed = useCallback(() => {
    setConfirmed({});
    setDismissedFor(sessionKey);
    setReviewOpen(false);
  }, [sessionKey]);

  const reset = useCallback(() => {
    startedRef.current = new Set();
    autoOpenedRef.current = null;
    setScans({});
    setConfirmed({});
    setDismissedFor(null);
    setReviewOpen(false);
  }, []);

  return { keys, scans, suggestions, confirmedFor: validConfirmed, allSettled, anyScanning, allConfirmed, reviewOpen, openReview, closeReview, confirm, discardConfirmed, reset };
}
