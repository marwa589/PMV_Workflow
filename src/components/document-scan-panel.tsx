"use client";

import { CheckCircle2, Loader2, ScanText } from "lucide-react";
import type { FileScanState } from "@/lib/document-scan/use-document-scan";

// The small card in the upload form that shows the scan progress and what the person has confirmed.

type Props = {
  files: File[];
  keys: string[];
  scans: Record<string, FileScanState>;
  anyScanning: boolean;
  allSettled: boolean;
  allConfirmed: boolean;
  onReview: () => void;
  onManual: () => void;
};

export default function DocumentScanPanel({ files, keys, scans, anyScanning, allSettled, allConfirmed, onReview, onManual }: Props) {
  if (files.length === 0) return null;

  if (anyScanning || !allSettled) {
    return (
      <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4" aria-live="polite">
        <div className="flex items-center gap-2 text-sm font-medium text-cyan-900">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading your {files.length > 1 ? "files" : "file"} to fill in the fields&hellip;
        </div>
        <ul className="mt-2 space-y-1 text-xs text-cyan-900/80">
          {files.map((file, index) => {
            const scan = scans[keys[index]];
            const percent = scan?.progress?.fraction != null ? ` (${Math.round(scan.progress.fraction * 100)}%)` : "";
            const text =
              !scan || scan.status === "waiting" ? "Waiting"
              : scan.status === "scanning" ? `${scan.progress?.message ?? "Reading"}${percent}`
              : scan.status === "done" ? "Read"
              : scan.status === "unsupported" ? "Cannot be read automatically (PDF and pictures only)"
              : "Could not be read";
            return (
              <li key={keys[index]} className="truncate">
                {file.name}: {text}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (allConfirmed) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-start gap-2 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            You confirmed the values for {files.length > 1 ? `all ${files.length} files` : "this file"}.
            {files.length > 1 ? " Each file becomes its own document with its own values." : ""}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={onReview} className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-900 hover:bg-emerald-100">
            Review or edit values
          </button>
          <button type="button" onClick={onManual} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Enter values manually instead
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm text-slate-700">The values read from your {files.length > 1 ? "files are" : "file is"} not confirmed yet. The fields below stay empty until you fill them in or confirm the scan.</p>
      <button type="button" onClick={onReview} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-cyan-700">
        <ScanText className="h-4 w-4" />
        Review values read from {files.length > 1 ? "my files" : "my file"}
      </button>
    </div>
  );
}
