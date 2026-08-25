"use client";

import { PDFDocument, degrees } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ArrowLeft, Check, Download, Loader2, PenLine, Plus, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

type PageInfo = { pageNumber: number; width: number; height: number };
type Placement = { id: string; pageNumber: number; x: number; y: number; width: number; height: number; rotation: number };
type DragState = { id: string; startX: number; startY: number; origin: Placement; mode: "drag" | "resize" };

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function isPdf(file: File) { return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"); }

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
  return pdfjs;
}

export default function DocumentReviewEditor({ documentId, documentNumber, title, hasSignature }: { documentId: string; documentNumber: string; title: string; hasSignature: boolean }) {
  const router = useRouter();
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const canvasRefs = useRef<Record<number, HTMLCanvasElement | null>>({});
  const pdfBytesRef = useRef<Uint8Array | null>(null);
  const pdfJsDocumentRef = useRef<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [signatureRatio, setSignatureRatio] = useState(3);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [zoom, setZoom] = useState(1);
  const [decision, setDecision] = useState<"APPROVE" | "REJECT" | "COMMENT">("APPROVE");
  const [comments, setComments] = useState("");
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const activePlacement = useMemo(() => placements[placements.length - 1] || null, [placements]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const startedAt = performance.now();
      try {
        const pdfjs = await loadPdfJs();
        const response = await fetch(`/api/documents/${documentId}/download`);
        if (!response.ok) throw new Error("Unable to load the current PDF version.");
        const pdfBytes = new Uint8Array(await response.arrayBuffer());
        const pdf = await pdfjs.getDocument({ data: pdfBytes.slice() }).promise;
        pdfBytesRef.current = pdfBytes;
        pdfJsDocumentRef.current = pdf;
        const nextPages: PageInfo[] = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1 });
          nextPages.push({ pageNumber, width: viewport.width, height: viewport.height });
        }
        if (!cancelled) setPages(nextPages);
        console.info(`[review] PDF loaded in ${Math.round(performance.now() - startedAt)}ms`, { documentId, pages: pdf.numPages, bytes: pdfBytes.byteLength });
      } catch {
        if (!cancelled) setError("Unable to display the current PDF version.");
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [documentId]);

  useEffect(() => {
    if (!hasSignature) return;
    const image = new Image();
    image.onload = () => {
      const ratio = image.naturalWidth / image.naturalHeight || 3;
      setSignatureRatio(ratio);
      setPlacements((current) => current.map((item) => {
        const page = pages.find((value) => value.pageNumber === item.pageNumber);
        if (!page) return item;
        const height = clamp(((item.width / 100) * page.width / ratio / page.height) * 100, 4, 100 - item.y);
        return { ...item, height };
      }));
    };
    image.src = "/api/auth/signature";
    setSignatureUrl("/api/auth/signature");
  }, [hasSignature, pages]);

  useEffect(() => {
    if (!pages.length) return;
    let cancelled = false;
    async function render() {
      const pdf = pdfJsDocumentRef.current;
      if (!pdf) return;
      const startedAt = performance.now();
      for (const info of pages) {
        if (cancelled) return;
        const page = await pdf.getPage(info.pageNumber);
        const element = pageRefs.current[info.pageNumber];
        const canvas = canvasRefs.current[info.pageNumber];
        const rect = element?.getBoundingClientRect();
        if (!canvas || !rect?.width) continue;
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const cssScale = rect.width / page.getViewport({ scale: 1 }).width;
        const viewport = page.getViewport({ scale: cssScale * dpr });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        const context = canvas.getContext("2d");
        if (context) await page.render({ canvasContext: context, canvas, viewport }).promise;
      }
      console.info(`[review] PDF rendered in ${Math.round(performance.now() - startedAt)}ms`, { documentId, pages: pages.length, zoom });
    }
    void render().catch(() => setError("Unable to render the PDF preview."));
    const resize = () => void render();
    window.addEventListener("resize", resize);
    return () => { cancelled = true; window.removeEventListener("resize", resize); };
  }, [documentId, pages, zoom]);

  useEffect(() => {
    if (!dragState) return;
    const activeDrag = dragState;
    function pageAt(x: number, y: number) {
      return pages.find((page) => {
        const rect = pageRefs.current[page.pageNumber]?.getBoundingClientRect();
        return rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      });
    }
    function move(event: PointerEvent) {
      const origin = activeDrag.origin;
      const targetPage = activeDrag.mode === "drag" ? pageAt(event.clientX, event.clientY) || pages.find((p) => p.pageNumber === origin.pageNumber) : pages.find((p) => p.pageNumber === origin.pageNumber);
      const rect = targetPage ? pageRefs.current[targetPage.pageNumber]?.getBoundingClientRect() : null;
      if (!rect) return;
      if (activeDrag.mode === "drag") {
        const x = ((event.clientX - rect.left) / rect.width) * 100;
        const y = ((event.clientY - rect.top) / rect.height) * 100;
        setPlacements((current) => current.map((item) => item.id === origin.id ? { ...item, pageNumber: targetPage?.pageNumber || origin.pageNumber, x: clamp(x - origin.width / 2, 0, 100 - origin.width), y: clamp(y - origin.height / 2, 0, 100 - origin.height) } : item));
      } else {
        const dx = ((event.clientX - activeDrag.startX) / rect.width) * 100;
        const width = clamp(origin.width + dx, 8, 100 - origin.x);
        const height = clamp(((width / 100) * rect.width / signatureRatio / rect.height) * 100, 4, 100 - origin.y);
        setPlacements((current) => current.map((item) => item.id === origin.id ? { ...item, width, height } : item));
      }
    }
    const end = () => setDragState(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
  }, [dragState, pages, signatureRatio]);

  function startDrag(event: React.PointerEvent<HTMLElement>, placement: Placement, mode: DragState["mode"]) {
    event.preventDefault();
    event.stopPropagation();
    setDragState({ id: placement.id, startX: event.clientX, startY: event.clientY, origin: placement, mode });
  }

  function addSignature(pageNumber: number) {
    if (!signatureUrl) {
      setError("Save a signature in Account Settings before signing.");
      return;
    }
    const page = pages.find((value) => value.pageNumber === pageNumber);
    const width = 24;
    const height = page ? clamp(((width / 100) * page.width / signatureRatio / page.height) * 100, 4, 18) : 10;
    setPlacements((current) => [...current, { id: `${Date.now()}-${Math.random()}`, pageNumber, x: 12, y: 78, width, height, rotation: 0 }]);
    setStatus("Signature added. Drag and resize it before approving.");
  }

  async function submit() {
    if (decision === "APPROVE" && placements.length === 0) {
      setError("Click Sign and place at least one signature before approving.");
      return;
    }
    setSaving(true);
    setError(null);
    const startedAt = performance.now();
    try {
      const formData = new FormData();
      formData.set("decision", decision);
      formData.set("comments", comments);
      if (decision === "APPROVE" && placements.length && signatureUrl) {
        const pdfBytes = pdfBytesRef.current;
        const coordinatePdf = pdfJsDocumentRef.current;
        if (!pdfBytes || !coordinatePdf) throw new Error("The PDF is still loading. Please try again.");
        const pdf = await PDFDocument.load(pdfBytes.slice());
        const signatureResponse = await fetch(signatureUrl);
        const signatureBlob = await signatureResponse.blob();
        const signatureBytes = await signatureBlob.arrayBuffer();
        const image = signatureBlob.type === "image/png" ? await pdf.embedPng(signatureBytes) : await pdf.embedJpg(signatureBytes);
        for (const item of placements) {
          const page = pdf.getPage(item.pageNumber - 1);
          const coordinatePage = await coordinatePdf.getPage(item.pageNumber);
          const viewport = coordinatePage.getViewport({ scale: 1 });
          const topLeft = viewport.convertToPdfPoint((item.x / 100) * viewport.width, (item.y / 100) * viewport.height);
          const topRight = viewport.convertToPdfPoint(((item.x + item.width) / 100) * viewport.width, (item.y / 100) * viewport.height);
          const bottomLeft = viewport.convertToPdfPoint((item.x / 100) * viewport.width, ((item.y + item.height) / 100) * viewport.height);
          const imageWidth = Math.hypot(topRight[0] - topLeft[0], topRight[1] - topLeft[1]);
          const imageHeight = Math.hypot(bottomLeft[0] - topLeft[0], bottomLeft[1] - topLeft[1]);
          const imageAngle = Math.atan2(topRight[1] - topLeft[1], topRight[0] - topLeft[0]) * (180 / Math.PI);
          const totalAngle = imageAngle - item.rotation;
          const totalRadians = totalAngle * (Math.PI / 180);
          const centerX = (topRight[0] + bottomLeft[0]) / 2;
          const centerY = (topRight[1] + bottomLeft[1]) / 2;
          const drawX = centerX - (Math.cos(totalRadians) * imageWidth / 2 - Math.sin(totalRadians) * imageHeight / 2);
          const drawY = centerY - (Math.sin(totalRadians) * imageWidth / 2 + Math.cos(totalRadians) * imageHeight / 2);
          page.drawImage(image, {
            x: item.rotation === 0 ? bottomLeft[0] : drawX,
            y: item.rotation === 0 ? bottomLeft[1] : drawY,
            width: imageWidth,
            height: imageHeight,
            rotate: degrees(totalAngle),
          });
        }
        const signedBytes = await pdf.save();
        const buffer = signedBytes.buffer.slice(signedBytes.byteOffset, signedBytes.byteOffset + signedBytes.byteLength) as ArrayBuffer;
        formData.set("file", new File([buffer], `${title}-signed.pdf`, { type: "application/pdf" }));
        formData.set("signatureCount", String(placements.length));
      }
      console.info(`[review] Action prepared in ${Math.round(performance.now() - startedAt)}ms`, { documentId, decision });
      const response = await fetch(`/api/documents/${documentId}/actions`, { method: "POST", headers: { "x-csrf-token": getCsrfTokenFromBrowser() }, body: formData });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message || "Unable to process document action.");
      console.info(`[review] Action request completed in ${Math.round(performance.now() - startedAt)}ms`, { documentId, decision });
      router.push("/approver/pending-approvals");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to process document action.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Document Review</p><h1 className="mt-2 text-2xl font-semibold">{documentNumber}</h1><p className="mt-1 text-sm text-slate-600">{title}</p></div>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => router.back()} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium"><ArrowLeft className="h-4 w-4" />Back</button><a href={`/api/documents/${documentId}/download`} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium"><Download className="h-4 w-4" />Download</a></div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-52 flex-1">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Decision</label>
              <select value={decision} onChange={(event) => setDecision(event.target.value as typeof decision)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="APPROVE">Approve</option>
                <option value="REJECT">Reject</option>
                <option value="COMMENT">Revision Required</option>
              </select>
            </div>
            <div className="min-w-72 flex-[2]">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Comments</label>
              <input value={comments} onChange={(event) => setComments(event.target.value)} placeholder="Comments (optional)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <button type="button" onClick={submit} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Submit Action
            </button>
          </div>
        </div>
        <div className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><button type="button" onClick={() => addSignature(activePlacement?.pageNumber || 1)} disabled={!hasSignature} className="inline-flex items-center gap-2 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><PenLine className="h-4 w-4" />Sign</button><span className="text-sm text-slate-500">{hasSignature ? `${placements.length} signature placement${placements.length === 1 ? "" : "s"}` : "Save a signature in Account Settings first."}</span></div><div className="flex items-center gap-2"><button type="button" onClick={() => setZoom((value) => Math.max(0.75, value - 0.1))} className="rounded-lg border px-3 py-2 text-sm">−</button><span className="min-w-16 text-center text-sm">{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom((value) => Math.min(1.5, value + 0.1))} className="rounded-lg border px-3 py-2 text-sm">+</button></div></div>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div> : null}{status ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{status}</div> : null}
        <section className="space-y-5 rounded-2xl border border-slate-200 bg-slate-950 p-4 shadow-sm">
          {pages.map((page) => <div key={page.pageNumber} ref={(element) => { pageRefs.current[page.pageNumber] = element; }} className="relative mx-auto overflow-visible bg-white shadow-2xl" style={{ width: `${page.width * zoom}px`, aspectRatio: `${page.width} / ${page.height}` }}><canvas ref={(element) => { canvasRefs.current[page.pageNumber] = element; }} className="absolute inset-0 h-full w-full" />{placements.filter((item) => item.pageNumber === page.pageNumber).map((item) => <div key={item.id} className="absolute border-2 border-cyan-500 bg-cyan-100/10" style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.width}%`, height: `${item.height}%`, touchAction: "none", transform: `rotate(${item.rotation}deg)` }} onPointerDown={(event) => startDrag(event, item, "drag")}><img src={signatureUrl || ""} alt="Saved signature" className="h-full w-full select-none object-fill" draggable={false} /><button type="button" aria-label="Rotate signature" title="Rotate signature" className="absolute -left-2 -top-7 rounded bg-cyan-700 p-1 text-white" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setPlacements((current) => current.map((value) => value.id === item.id ? { ...value, rotation: (value.rotation + 90) % 360 } : value)); }}><RotateCw className="h-3 w-3" /></button><button type="button" aria-label="Resize signature" className="absolute -bottom-2 -right-2 h-5 w-5 rounded-full border-2 border-white bg-cyan-700" onPointerDown={(event) => startDrag(event, item, "resize")} /><button type="button" aria-label="Remove signature placement" className="absolute -right-2 -top-7 rounded bg-rose-600 p-1 text-white" onClick={() => setPlacements((current) => current.filter((value) => value.id !== item.id))}><Trash2 className="h-3 w-3" /></button></div>)}</div>)}
        </section>
      </div>
    </main>
  );
}
