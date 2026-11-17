"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, ExternalLink, Loader2 } from "lucide-react";
import type { RelatedDocument } from "@/lib/related-documents";

// Decoders for scanned pages are loaded from here (same as the review screen); see api/pdfjs-wasm.
const PDFJS_WASM_URL = typeof window === "undefined" ? undefined : `${window.location.origin}/api/pdfjs-wasm/`;

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
  return pdfjs;
}

/** Read-only PDF pages, drawn to the width of the panel. Loaded only when the panel is opened. */
function PdfPreview({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    async function render() {
      try {
        const pdfjs = await loadPdfJs();
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error("Unable to load the file.");
        const data = new Uint8Array(await response.arrayBuffer());
        const pdf = await pdfjs.getDocument({ data, wasmUrl: PDFJS_WASM_URL }).promise;
        if (cancelled || !container) return;
        container.replaceChildren();
        const width = Math.max(320, container.clientWidth);
        const ratio = window.devicePixelRatio || 1;
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * ratio });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = "100%";
          canvas.className = "block bg-white shadow";
          container.appendChild(canvas);
          const context = canvas.getContext("2d");
          if (context) await page.render({ canvasContext: context, viewport, canvas }).promise;
        }
        if (!cancelled) setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    }
    void render();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div>
      {state === "loading" ? (
        <p className="flex items-center gap-2 px-1 py-6 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading preview…
        </p>
      ) : null}
      {state === "error" ? <p className="px-1 py-6 text-sm text-rose-700">The preview could not be shown. Use Open or Download instead.</p> : null}
      <div ref={containerRef} className="space-y-4" />
    </div>
  );
}

function Preview({ item }: { item: RelatedDocument }) {
  if (item.fileKind === "pdf") return <PdfPreview url={item.previewUrl} />;
  if (item.fileKind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.previewUrl} alt={`${item.documentNumber} - ${item.title}`} className="mx-auto block max-h-[80vh] max-w-full bg-white shadow" />;
  }
  return <p className="px-1 py-6 text-sm text-slate-600">{item.originalName ?? "This file"} cannot be previewed here. Use Download to open it.</p>;
}

/**
 * "Related documents" of a document under review: the documents above it in its process (first document first) and
 * the reference documents attached to them, one under the other. Each opens and closes on its own; the one the
 * reviewed document follows directly starts open.
 */
export default function RelatedDocumentsPanel({ items }: { items: RelatedDocument[] }) {
  const nearestTree = [...items].reverse().find((item) => item.kind === "tree") ?? items[0] ?? null;
  const [open, setOpen] = useState<Record<string, boolean>>(() => (nearestTree ? { [nearestTree.id]: true } : {}));

  if (items.length === 0) {
    return <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">No related documents you can view.</p>;
  }

  const allOpen = items.every((item) => open[item.id]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          Documents this one follows in its process, first document first{items.some((item) => item.kind === "reference") ? ", with their reference documents" : ""}.
        </p>
        <button
          type="button"
          onClick={() => setOpen(Object.fromEntries(items.map((item) => [item.id, !allOpen])))}
          className="text-xs font-medium text-cyan-700 hover:underline"
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {items.map((item, index) => {
        const isOpen = Boolean(open[item.id]);
        return (
          <section key={item.id} className={`rounded-xl border bg-white shadow-sm ${item.kind === "reference" ? "ml-4 border-violet-200" : "border-slate-200"}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <button
                type="button"
                onClick={() => setOpen((current) => ({ ...current, [item.id]: !isOpen }))}
                aria-expanded={isOpen}
                className="flex min-w-0 flex-1 items-start gap-2 text-left"
              >
                <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    {item.kind === "tree" ? (
                      <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">{index + 1}</span>
                    ) : (
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800">Reference</span>
                    )}
                    <span className="text-sm font-semibold text-slate-900">{item.documentNumber}</span>
                    <span className="truncate text-sm text-slate-600">{item.title}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {item.stepName ? `${item.stepName} · ` : ""}
                    {item.typeLabel} · {item.statusLabel}
                    {item.attachedTo ? ` · attached to ${item.attachedTo}` : ""}
                  </span>
                </span>
              </button>
              <div className="flex items-center gap-2">
                <a href={`/documents/${item.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <ExternalLink className="h-3.5 w-3.5" /> Open
                </a>
                <a href={item.downloadUrl} download className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <Download className="h-3.5 w-3.5" /> Download
                </a>
              </div>
            </div>
            {isOpen ? (
              <div className="border-t border-slate-200 bg-slate-100 p-4">
                <Preview item={item} />
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
