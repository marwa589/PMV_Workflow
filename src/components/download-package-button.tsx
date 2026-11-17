"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Files, FileStack, Loader2, PackageOpen } from "lucide-react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

type Props = {
  // The document(s) to download together with everything linked to them.
  ids: string[];
  label?: string;
  disabled?: boolean;
  // A small button for table rows.
  compact?: boolean;
};

type Mode = "separate" | "single";

function fileNameFrom(response: Response): string {
  const header = response.headers.get("content-disposition") ?? "";
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      /* fall through */
    }
  }
  return header.match(/filename="([^"]+)"/i)?.[1] ?? "package.pdf";
}

/**
 * "Download package": each document plus every document linked to it, merged into one PDF named after the document's
 * file. With one document it downloads at once. With several documents it offers two choices:
 *  - Separate files: one PDF per selected document (a ZIP holds them);
 *  - One file: everything merged into a single PDF.
 * There is no limit on how many documents can be selected: the ids are sent in the request body.
 */
export default function DownloadPackageButton({ ids, label = "Download package", disabled = false, compact = false }: Props) {
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inactive = disabled || ids.length === 0 || busy;
  const several = ids.length > 1;
  const size = compact ? "px-3 py-1.5 text-xs" : "px-3 py-2 text-sm";
  const iconSize = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  const className = `inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white font-medium text-slate-700 hover:bg-slate-50 ${size} ${inactive ? "pointer-events-none opacity-50" : ""}`;

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  async function download(mode: Mode) {
    if (inactive) return;
    setMenuOpen(false);
    setBusy(true);
    try {
      const response = await fetch("/api/documents/package", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": getCsrfTokenFromBrowser() },
        body: JSON.stringify({ ids, mode }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { message?: string } | null;
        window.alert(result?.message || "Unable to download the package.");
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameFrom(response);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.alert("Unable to download the package.");
    } finally {
      setBusy(false);
    }
  }

  const icon = busy ? <Loader2 className={`${iconSize} animate-spin`} /> : <PackageOpen className={iconSize} />;

  if (!several) {
    return (
      <button type="button" onClick={() => download("separate")} disabled={inactive} title="Download this document together with all documents linked to it, as one PDF" className={className}>
        {icon}
        {label}
      </button>
    );
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        disabled={inactive}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="Download the selected documents together with all documents linked to them"
        className={className}
      >
        {icon}
        {label}
        <ChevronDown className={iconSize} />
      </button>
      {menuOpen ? (
        <div role="menu" className="absolute left-0 z-40 mt-1 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <button type="button" role="menuitem" onClick={() => download("separate")} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50">
            <Files className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <span>
              <span className="block text-sm font-medium text-slate-900">Separate files</span>
              <span className="block text-xs text-slate-500">One PDF per selected document, in a ZIP.</span>
            </span>
          </button>
          <button type="button" role="menuitem" onClick={() => download("single")} className="flex w-full items-start gap-3 border-t border-slate-100 px-4 py-3 text-left hover:bg-slate-50">
            <FileStack className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <span>
              <span className="block text-sm font-medium text-slate-900">One file</span>
              <span className="block text-xs text-slate-500">Everything merged into a single PDF.</span>
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
