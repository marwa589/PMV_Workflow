"use client";

import { PDFDocument, degrees, rgb } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ArrowLeft, Check, Download, Loader2, PenLine, RotateCw, Search, Send, Trash2, Type, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import RelatedDocumentsPanel from "@/components/related-documents-panel";
import type { RelatedDocument } from "@/lib/related-documents";
import { useRouter } from "next/navigation";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

type PageInfo = { pageNumber: number; width: number; height: number };
type Placement = { id: string; pageNumber: number; x: number; y: number; width: number; height: number; rotation: number };
type CirclePlacement = { id: string; pageNumber: number; x: number; y: number; width: number; height: number };
type TextBoxPlacement = { id: string; pageNumber: number; x: number; y: number; width: number; height: number; text: string; color: string; fontSize: number };
type DragState = { id: string; startX: number; startY: number; origin: Placement; mode: "drag" | "resize" };
type CircleDragState = { id: string; pageNumber: number; startX: number; startY: number; rect: DOMRect };
type TextBoxDragState = { id: string; pageNumber: number; startX: number; startY: number; rect: DOMRect };

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function isPdf(file: File) { return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"); }

// Decoders for scanned pages (CCITT / JBIG2 / JPEG 2000 images) are loaded from here; see api/pdfjs-wasm.
const PDFJS_WASM_URL = typeof window === "undefined" ? undefined : `${window.location.origin}/api/pdfjs-wasm/`;

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
  return pdfjs;
}

type EditorDecision = "APPROVE" | "REJECT" | "REQUEST_REVISION" | "HOLD" | "RESUME" | "SEND_FOR_APPROVAL";
export type SendRecipient = { id: string; name: string; email: string; userTypeName: string };

/** Searchable list of users: type part of a name, email or user type, then click the person. */
function RecipientPicker({ recipients, selectedId, onSelect, disabled }: { recipients: SendRecipient[]; selectedId: string | null; onSelect: (id: string | null) => void; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selected = recipients.find((candidate) => candidate.id === selectedId) ?? null;
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return recipients;
    return recipients.filter((candidate) => `${candidate.name} ${candidate.email} ${candidate.userTypeName}`.toLowerCase().includes(needle));
  }, [recipients, query]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function choose(candidate: SendRecipient) {
    onSelect(candidate.id);
    setQuery("");
    setOpen(false);
  }

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">{selected.name}</p>
          <p className="truncate text-xs text-slate-600">{selected.email} · {selected.userTypeName}</p>
        </div>
        <button type="button" onClick={() => onSelect(null)} disabled={disabled} aria-label="Choose someone else" title="Choose someone else" className="rounded p-1 text-slate-500 hover:bg-cyan-100 hover:text-slate-900 disabled:opacity-50"><X className="h-4 w-4" /></button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls="send-recipient-list"
        aria-label="Search users"
        value={query}
        disabled={disabled}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "Enter") { event.preventDefault(); if (matches[0]) choose(matches[0]); }
        }}
        placeholder="Search by name or email"
        className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm"
      />
      {open ? (
        <ul id="send-recipient-list" role="listbox" className="absolute left-0 right-0 z-40 mt-1 max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {matches.length === 0 ? <li className="px-3 py-2 text-sm text-slate-500">No user matches “{query.trim()}”.</li> : null}
          {matches.map((candidate) => (
            <li key={candidate.id} role="option" aria-selected={false}>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(candidate)} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                <span className="font-medium text-slate-900">{candidate.name}</span>
                <span className="block text-xs text-slate-500">{candidate.email} · {candidate.userTypeName}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
export type BatchDecision = "APPROVE" | "REJECT";
export type BatchAction = { validate: (decision: BatchDecision) => string | null; submit: (decision: BatchDecision) => Promise<boolean> };

type DocumentReviewEditorProps = {
  documentId: string;
  documentNumber: string;
  title: string;
  hasSignature: boolean;
  allowNoSignature?: boolean;
  // The document's status: a document on hold can only be resumed.
  documentStatus?: string;
  revisionMode?: boolean;
  revisionComment?: string | null;
  // Earlier steps the document can be sent back to (0 = the uploader), named from the document's own flow.
  revisionTargets?: Array<{ levelNumber: number; label: string }>;
  // Unique tracks of the level this document waits at: ticking one sends the approved document straight to that person.
  tracks?: Array<{ id: string; name: string; receiverName: string; returnLabel: string }>;
  // "Send for approval": every active user the reviewer may pick (empty = the reviewer does not have that option).
  sendRecipients?: SendRecipient[];
  // Set when this document was sent to the current person for approval: the name of the sender it returns to.
  sentForApprovalBy?: string | null;
  downloadUrl?: string;
  // Reference documents attached to this document that the reviewer may see (opened in a new tab so the review is not lost).
  referenceDocuments?: Array<{ id: string; documentNumber: string; title: string; typeName: string }>;
  // Documents above this one in its process and their reference documents ("Related documents" tab); only those the reviewer may open.
  relatedDocuments?: RelatedDocument[];
  actionUrl?: string;
  returnUrl?: string;
  allowHold?: boolean;
  // Batch mode: this editor is one of several stacked on the batch review screen, which submits them one after another.
  batchMode?: boolean;
  batchActive?: boolean;
  batchSubmitting?: boolean;
  batchDecision?: BatchDecision;
  onBatchDecisionChange?: (decision: BatchDecision) => void;
  onBatchSubmit?: () => void;
  onBatchAction?: (documentId: string, action: BatchAction | null) => void;
};

export default function DocumentReviewEditor({
  documentId,
  documentNumber,
  title,
  hasSignature,
  allowNoSignature = false,
  documentStatus = "PENDING",
  revisionMode = false,
  revisionComment = null,
  revisionTargets = [],
  tracks = [],
  sendRecipients = [],
  sentForApprovalBy = null,
  downloadUrl = `/api/documents/${documentId}/download`,
  referenceDocuments = [],
  relatedDocuments = [],
  actionUrl = `/api/documents/${documentId}/actions`,
  returnUrl = "/approver/pending-approvals",
  allowHold = false,
  batchMode = false,
  batchActive = false,
  batchSubmitting = false,
  batchDecision = "APPROVE",
  onBatchDecisionChange,
  onBatchSubmit,
  onBatchAction,
}: DocumentReviewEditorProps) {
  const router = useRouter();
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const canvasRefs = useRef<Record<number, HTMLCanvasElement | null>>({});
  const pdfBytesRef = useRef<Uint8Array | null>(null);
  const pdfJsDocumentRef = useRef<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [signatureRatio, setSignatureRatio] = useState(3);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [circles, setCircles] = useState<CirclePlacement[]>([]);
  const [textBoxes, setTextBoxes] = useState<TextBoxPlacement[]>([]);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [circleMode, setCircleMode] = useState(false);
  const [circleDrag, setCircleDrag] = useState<CircleDragState | null>(null);
  const [textBoxMode, setTextBoxMode] = useState(false);
  const [textBoxDrag, setTextBoxDrag] = useState<TextBoxDragState | null>(null);
  const [textBoxColor, setTextBoxColor] = useState("#0f172a");
  const [textBoxFontSize, setTextBoxFontSize] = useState(12);
  const [selectedTextBoxId, setSelectedTextBoxId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  // "Document" (the one being reviewed) or "Related documents" (the ones it follows, read only).
  const [viewTab, setViewTab] = useState<"document" | "related">("document");
  const [trackId, setTrackId] = useState<string | null>(null);
  const [decision, setDecision] = useState<EditorDecision>(documentStatus === "ON_HOLD" ? "RESUME" : "APPROVE");
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [requireSignature, setRequireSignature] = useState(true);
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [comments, setComments] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Blocks a second click while a decision is being sent (state updates are too slow to catch a fast double click).
  const submittingRef = useRef(false);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current); }, []);

  const activePlacement = useMemo(() => placements[placements.length - 1] || null, [placements]);
  const signatureUrl = hasSignature ? "/api/auth/signature" : null;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const startedAt = performance.now();
      try {
        const pdfjs = await loadPdfJs();
        const response = await fetch(downloadUrl, {
  cache: "no-store",
});
        if (!response.ok) throw new Error("Unable to load the current PDF version.");
        const pdfBytes = new Uint8Array(await response.arrayBuffer());
        const pdf = await pdfjs.getDocument({ data: pdfBytes.slice(), wasmUrl: PDFJS_WASM_URL }).promise;
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
  }, [documentId, downloadUrl]);

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
  }, [documentId, pages, zoom, viewTab]);

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

  useEffect(() => {
    if (!circleDrag) return;
    const activeCircle = circleDrag;
    function move(event: PointerEvent) {
      const endX = clamp(((event.clientX - activeCircle.rect.left) / activeCircle.rect.width) * 100, 0, 100);
      const endY = clamp(((event.clientY - activeCircle.rect.top) / activeCircle.rect.height) * 100, 0, 100);
      const startX = (activeCircle.startX / activeCircle.rect.width) * 100;
      const startY = (activeCircle.startY / activeCircle.rect.height) * 100;
      const width = Math.abs(endX - startX);
      const height = Math.abs(endY - startY);
      setCircles((current) => current.map((item) => item.id === activeCircle.id ? {
        ...item,
        x: Math.min(startX, endX),
        y: Math.min(startY, endY),
        width,
        height,
      } : item));
    }
    const end = () => {
      setCircleDrag(null);
      setCircleMode(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
  }, [circleDrag]);

  useEffect(() => {
    if (!textBoxDrag) return;
    const activeTextBox = textBoxDrag;
    function move(event: PointerEvent) {
      const endX = clamp(((event.clientX - activeTextBox.rect.left) / activeTextBox.rect.width) * 100, 0, 100);
      const endY = clamp(((event.clientY - activeTextBox.rect.top) / activeTextBox.rect.height) * 100, 0, 100);
      const startX = (activeTextBox.startX / activeTextBox.rect.width) * 100;
      const startY = (activeTextBox.startY / activeTextBox.rect.height) * 100;
      setTextBoxes((current) => current.map((item) => item.id === activeTextBox.id ? {
        ...item,
        x: Math.min(startX, endX),
        y: Math.min(startY, endY),
        width: Math.abs(endX - startX),
        height: Math.abs(endY - startY),
      } : item));
    }
    const end = () => {
      setTextBoxDrag(null);
      setTextBoxMode(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
  }, [textBoxDrag]);

  function startDrag(event: React.PointerEvent<HTMLElement>, placement: Placement, mode: DragState["mode"]) {
    event.preventDefault();
    event.stopPropagation();
    setDragState({ id: placement.id, startX: event.clientX, startY: event.clientY, origin: placement, mode });
  }

  // The signature goes where the person is looking: on the page that fills most of the screen, at the middle of
  // the part of that page they can see (not on page 1 when they are reading page 4).
  function addSignature(fallbackPage: number) {
    if (!signatureUrl) {
      setError("Save a signature in Account Settings before signing.");
      return;
    }
    const topEdge = 80; // the sticky toolbar covers the top of the screen
    const bottomEdge = window.innerHeight;
    let best: { pageNumber: number; visible: number; centerY: number; rect: DOMRect } | null = null;
    for (const info of pages) {
      const rect = pageRefs.current[info.pageNumber]?.getBoundingClientRect();
      if (!rect) continue;
      const from = Math.max(rect.top, topEdge);
      const to = Math.min(rect.bottom, bottomEdge);
      const visible = to - from;
      if (visible > 0 && (!best || visible > best.visible)) best = { pageNumber: info.pageNumber, visible, centerY: (from + to) / 2, rect };
    }
    const pageNumber = best?.pageNumber ?? fallbackPage;
    const page = pages.find((value) => value.pageNumber === pageNumber);
    const width = 24;
    const height = page ? clamp(((width / 100) * page.width / signatureRatio / page.height) * 100, 4, 18) : 10;
    const x = clamp(50 - width / 2, 0, 100 - width);
    const y = best ? clamp(((best.centerY - best.rect.top) / best.rect.height) * 100 - height / 2, 0, 100 - height) : 78;
    setPlacements((current) => [...current, { id: crypto.randomUUID(), pageNumber, x, y, width, height, rotation: 0 }]);
    setStatus(`Signature added on page ${pageNumber}. Drag and resize it before approving.`);
  }

  function startCircle(event: React.PointerEvent<HTMLDivElement>, pageNumber: number) {
    if (textBoxMode || !circleMode || circleDrag) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    const id = crypto.randomUUID();
    setCircles((current) => [...current, { id, pageNumber, x, y, width: 0, height: 0 }]);
    setCircleDrag({ id, pageNumber, startX: event.clientX - rect.left, startY: event.clientY - rect.top, rect });
    event.preventDefault();
  }

  function startTextBox(event: React.PointerEvent<HTMLDivElement>, pageNumber: number) {
    if (!textBoxMode || textBoxDrag) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100);
    const y = clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100);
    const id = crypto.randomUUID();
    setTextBoxes((current) => [...current, { id, pageNumber, x, y, width: 0, height: 0, text: "", color: textBoxColor, fontSize: textBoxFontSize }]);
    setSelectedTextBoxId(id);
    setTextBoxDrag({ id, pageNumber, startX: event.clientX - rect.left, startY: event.clientY - rect.top, rect });
    event.preventDefault();
  }

  function submit() {
    void runDecision(decision, false);
  }

  // Sends one decision for this document. Batch mode returns true/false and leaves navigation to the batch screen.
  async function runDecision(decision: EditorDecision, batch: boolean): Promise<boolean> {
    const action = revisionMode && decision !== "REJECT" ? "RESUBMIT" : decision;
    const requiresSignature = !revisionMode && decision === "APPROVE" && !(allowNoSignature && placements.length === 0);
    if (revisionMode && replacementFile && !isPdf(replacementFile)) {
      setError("The replacement document must be a PDF so it can be reviewed in the approval workflow.");
      return false;
    }
    if (!revisionMode && decision === "APPROVE" && placements.length === 0 && !allowNoSignature) {
      setError("Click Sign and place at least one signature before approving.");
      return false;
    }
    if (!revisionMode && decision === "REQUEST_REVISION" && !comments.trim()) {
      setError("Write a comment that tells the person what to fix.");
      return false;
    }
    if (!revisionMode && decision === "SEND_FOR_APPROVAL" && !recipientId) {
      setError("Choose the person who should approve this document first.");
      return false;
    }
    if (submittingRef.current) return false;
    submittingRef.current = true;
    let handedOffToNavigation = false;
    setSaving(true);
    setError(null);
    const startedAt = performance.now();
    try {
      const formData = new FormData();
      formData.set("decision", action);
      formData.set("comments", comments);
      if (!batch && !revisionMode && decision === "APPROVE" && trackId) formData.set("trackId", trackId);
      if (!batch && !revisionMode && decision === "SEND_FOR_APPROVAL" && recipientId) {
        formData.set("recipientUserId", recipientId);
        formData.set("signatureRequired", String(requireSignature));
      }
      if (revisionMode && decision === "REJECT") {
        formData.set("decision", "REJECT");
      } else if (revisionMode && replacementFile) {
        formData.set("file", replacementFile);
      } else if (
        decision === "APPROVE" ||
        revisionMode ||
        (decision === "REQUEST_REVISION" &&
          (circles.some((item) => item.width > 0 && item.height > 0) ||
            textBoxes.some((item) => item.width > 0 && item.height > 0 && item.text.trim())))
      ) {
        const pdfBytes = pdfBytesRef.current;
        const coordinatePdf = pdfJsDocumentRef.current;
        if (!pdfBytes || !coordinatePdf) throw new Error("The PDF is still loading. Please try again.");

        const pdf = await PDFDocument.load(pdfBytes.slice());
        if (decision === "APPROVE" && placements.length && signatureUrl) {
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
        }
        for (const item of circles) {
            const page = pdf.getPage(item.pageNumber - 1);
            const coordinatePage = await coordinatePdf.getPage(item.pageNumber);
            const viewport = coordinatePage.getViewport({ scale: 1 });
            const topLeft = viewport.convertToPdfPoint((item.x / 100) * viewport.width, (item.y / 100) * viewport.height);
            const bottomRight = viewport.convertToPdfPoint(((item.x + item.width) / 100) * viewport.width, ((item.y + item.height) / 100) * viewport.height);
            const left = Math.min(topLeft[0], bottomRight[0]);
            const right = Math.max(topLeft[0], bottomRight[0]);
            const bottom = Math.min(topLeft[1], bottomRight[1]);
            const top = Math.max(topLeft[1], bottomRight[1]);
            page.drawEllipse({
              x: (left + right) / 2,
              y: (bottom + top) / 2,
              xScale: (right - left) / 2,
              yScale: (top - bottom) / 2,
              borderColor: rgb(0.85, 0.1, 0.1),
              borderWidth: 2,
            });
        }
        for (const item of textBoxes) {
            const page = pdf.getPage(item.pageNumber - 1);
            const coordinatePage = await coordinatePdf.getPage(item.pageNumber);
            const viewport = coordinatePage.getViewport({ scale: 1 });
            const topLeft = viewport.convertToPdfPoint((item.x / 100) * viewport.width, (item.y / 100) * viewport.height);
            const bottomRight = viewport.convertToPdfPoint(((item.x + item.width) / 100) * viewport.width, ((item.y + item.height) / 100) * viewport.height);
            const left = Math.min(topLeft[0], bottomRight[0]);
            const right = Math.max(topLeft[0], bottomRight[0]);
            const top = Math.max(topLeft[1], bottomRight[1]);
            const red = Number.parseInt(item.color.slice(1, 3), 16) / 255;
            const green = Number.parseInt(item.color.slice(3, 5), 16) / 255;
            const blue = Number.parseInt(item.color.slice(5, 7), 16) / 255;
            if (item.text.trim()) {
              page.drawText(item.text, { x: left + 5, y: top - item.fontSize - 4, size: item.fontSize, maxWidth: Math.max(20, right - left - 10), color: rgb(red, green, blue) });
            }
        }
        const editedBytes = await pdf.save();
        const buffer = editedBytes.buffer.slice(editedBytes.byteOffset, editedBytes.byteOffset + editedBytes.byteLength) as ArrayBuffer;
        const fileSuffix = revisionMode ? "-revised" : decision === "REQUEST_REVISION" ? "-revision-notes" : "-signed";
        formData.set("file", new File([buffer], `${title}${fileSuffix}.pdf`, { type: "application/pdf" }));
        formData.set("signatureCount", String(placements.length));
      }
      console.info(`[review] Action prepared in ${Math.round(performance.now() - startedAt)}ms`, { documentId, decision: action, requiresSignature });
      const response = await fetch(actionUrl, {
  method: "POST",
  headers: {
    "x-csrf-token": getCsrfTokenFromBrowser(),
  },
  body: formData,
});
      // A proxy or gateway error can come back as an HTML page, so reading it as JSON must not throw.
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(result.message || `Unable to process document action (HTTP ${response.status}).`);
      console.info(`[review] Action request completed in ${Math.round(performance.now() - startedAt)}ms`, { documentId, decision: action });
      if (batch) {
        setStatus(decision === "APPROVE" ? "Approved and submitted." : "Rejected and submitted.");
      } else {
        // The decision is saved. Keep the button locked so it cannot be sent twice while the page changes.
        // The lists are rendered fresh on every visit, so one replace is enough (no extra refresh to race with it).
        handedOffToNavigation = true;
        setStatus("Saved. Returning to your tasks...");
        router.replace(returnUrl);
        // Safety net: if the page has not changed after a few seconds, go there with a normal page load.
        redirectTimerRef.current = setTimeout(() => window.location.assign(returnUrl), 4000);
      }
      return true;
    } catch (submitError) {
      console.error("[review] Action failed", { documentId, decision: action, error: submitError });
      setError(submitError instanceof Error ? submitError.message : "Unable to process document action.");
      return false;
    } finally {
      if (!handedOffToNavigation) {
        submittingRef.current = false;
        setSaving(false);
      }
    }
  }

  // Checked for every document before anything is sent, so one missing signature stops the whole batch early.
  function validateBatch(nextDecision: BatchDecision): string | null {
    if (nextDecision === "APPROVE" && !allowNoSignature && !hasSignature) return "Save a signature in Account Settings before approving.";
    if (nextDecision === "APPROVE" && placements.length === 0 && !allowNoSignature) return "Click Sign and place a signature before approving.";
    if (nextDecision === "APPROVE" && (!pdfBytesRef.current || !pdfJsDocumentRef.current)) return "The PDF is still loading. Please try again.";
    return null;
  }

  // Runs after every render so the batch screen always holds the latest placements and comments for this document.
  useEffect(() => {
    if (!batchMode || !onBatchAction) return;
    onBatchAction(documentId, { validate: validateBatch, submit: (nextDecision) => runDecision(nextDecision, true) });
    return () => onBatchAction(documentId, null);
  });

  return (
    <main className={batchMode ? "bg-slate-100 px-4 py-4 text-slate-900 sm:px-8" : "min-h-screen bg-slate-100 px-4 py-8 text-slate-900 sm:px-8"}>
      <div className="mx-auto max-w-6xl space-y-5">
        {!batchMode ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{revisionMode ? "Revise Document" : "Document Review"}</p><h1 className="mt-2 text-2xl font-semibold">{documentNumber}</h1><p className="mt-1 text-sm text-slate-600">{title}</p></div>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => router.back()} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium"><ArrowLeft className="h-4 w-4" />Back</button><a href={downloadUrl} download className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium"><Download className="h-4 w-4" />Download</a>{referenceDocuments.map((reference) => (
            <a key={reference.id} href={`/documents/${reference.id}`} target="_blank" rel="noopener noreferrer" title={`${reference.documentNumber} · ${reference.title}`} className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100">
              {referenceDocuments.length > 1 ? `View referenced ${reference.typeName} (${reference.documentNumber})` : `View referenced ${reference.typeName}`}
            </a>
          ))}</div>
        </div> : null}
        {!batchMode && sentForApprovalBy ? <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-sm text-cyan-900"><p className="font-semibold">Sent to you for approval</p><p className="mt-1">{sentForApprovalBy} asked you to approve this document. When you approve it, it goes back to {sentForApprovalBy}.</p></div> : null}
        {!batchMode ? <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {revisionMode ? (
            <div className="space-y-4">
              {revisionComment ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-semibold">Revision requested</p><p className="mt-1">{revisionComment}</p></div> : null}
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-52 flex-1">
                  <label htmlFor="revision-decision" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Action</label>
                  <select id="revision-decision" value={decision === "REJECT" ? "REJECT" : "RESUBMIT"} onChange={(event) => setDecision(event.target.value as typeof decision)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    <option value="RESUBMIT">Resubmit to reviewer</option>
                    <option value="REJECT">Reject document</option>
                  </select>
                </div>
                {decision === "REJECT" ? (
                  <div key="revision-rejection" className="min-w-72 flex-[2]">
                    <label htmlFor="revision-rejection-comment" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Rejection reason (optional)</label>
                    <input id="revision-rejection-comment" type="text" value={comments ?? ""} onChange={(event) => setComments(event.target.value)} placeholder="Comments (optional)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  </div>
                ) : (
                <div key="revision-replacement" className="min-w-72 flex-[2]">
                  <label htmlFor="replacement-file" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Replace document (optional)</label>
                  <input id="replacement-file" type="file" accept=".pdf,application/pdf" onChange={(event) => setReplacementFile(event.target.files?.[0] ?? null)} disabled={saving} className="w-full rounded-md border border-slate-300 text-sm file:mr-3 file:cursor-pointer file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:font-medium file:text-white hover:file:bg-blue-700" />
                </div>
                )}
                {decision !== "REJECT" ? (
                <div className="min-w-72 flex-[2]">
                  <label htmlFor="revision-comments" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Comments to reviewer</label>
                  <input id="revision-comments" value={comments} onChange={(event) => setComments(event.target.value)} placeholder="Comments (optional)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                </div>
                ) : null}
                <button type="button" onClick={submit} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {decision === "REJECT" ? "Reject Document" : "Resubmit to Reviewer"}
                </button>
              </div>
            </div>
          ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-52 flex-1">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Decision</label>
              <select
                value={decision === "APPROVE" && trackId ? `TRACK:${trackId}` : decision}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value.startsWith("TRACK:")) {
                    setTrackId(value.slice(6));
                    setDecision("APPROVE");
                  } else {
                    setTrackId(null);
                    setDecision(value as typeof decision);
                  }
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {documentStatus === "ON_HOLD" ? (
                  <option value="RESUME">Resume</option>
                ) : (
                  <>
                    <option value="APPROVE">Approve</option>
                    {tracks.map((track) => <option key={track.id} value={`TRACK:${track.id}`}>{track.name}</option>)}
                    <option value="REJECT">Reject</option>
                    {revisionTargets.length > 0 ? <option value="REQUEST_REVISION">Revision Required</option> : null}
                    {sendRecipients.length > 0 ? <option value="SEND_FOR_APPROVAL">Send for approval</option> : null}
                    {allowHold ? <option value="HOLD">On Hold</option> : null}
                  </>
                )}
              </select>
            </div>
            {decision === "REQUEST_REVISION" ? (
              <p className="min-w-60 flex-1 text-xs text-slate-500">The document always goes back to the previous level.</p>
            ) : null}
            {decision === "SEND_FOR_APPROVAL" ? (
              <div className="flex w-full flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="min-w-72 flex-[2]">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Send to</label>
                  <RecipientPicker recipients={sendRecipients} selectedId={recipientId} onSelect={setRecipientId} disabled={saving} />
                </div>
                <div className="flex items-center gap-2 pb-2">
                  <button type="button" role="switch" aria-checked={requireSignature} aria-label="Require signature" onClick={() => setRequireSignature((value) => !value)} disabled={saving} className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${requireSignature ? "bg-cyan-600" : "bg-slate-300"}`}>
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${requireSignature ? "translate-x-5" : "translate-x-0.5"}`} />
                  </button>
                  <span className="text-sm font-medium text-slate-700">Require signature</span>
                </div>
                <p className="w-full text-xs text-slate-500">
                  {(() => {
                    const chosen = sendRecipients.find((candidate) => candidate.id === recipientId);
                    return chosen
                      ? `${chosen.name} reviews${requireSignature ? " and signs" : ""} this document first. When they approve it, it comes back to you to continue.`
                      : "Pick the person who must approve this document first. When they approve it, it comes back to you.";
                  })()}
                </p>
              </div>
            ) : null}
            {decision === "APPROVE" && trackId ? (
              <p className="min-w-60 flex-1 text-xs text-slate-500">
                {(() => {
                  const chosen = tracks.find((track) => track.id === trackId);
                  return chosen ? `Approves this level, then goes to ${chosen.receiverName}, then ${chosen.returnLabel}.` : null;
                })()}
              </p>
            ) : null}
            <div className="min-w-72 flex-[2]">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Comments</label>
              <input value={comments} onChange={(event) => setComments(event.target.value)} placeholder={decision === "REQUEST_REVISION" ? "Comment (required)" : "Comments (optional)"} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <button type="button" onClick={submit} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {decision === "APPROVE" ? (trackId ? "Approve & forward" : "Approve") : decision === "REJECT" ? "Reject Document" : decision === "SEND_FOR_APPROVAL" ? "Send for approval" : "Submit Action"}
            </button>
          </div>
          )}
        </div> : null}
        {!batchMode || batchActive ? <div className={`${batchMode ? "fixed left-1/2 top-3 z-[60] w-[calc(100%-2rem)] max-w-6xl -translate-x-1/2 shadow-lg" : "sticky top-0 z-30 shadow-sm"} flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4`}><div className="flex flex-wrap items-center gap-2">{batchMode ? <div className="mr-2 min-w-48"><p className="text-xs font-semibold uppercase text-slate-500">Current document</p><p className="max-w-64 truncate text-sm font-semibold text-slate-900" title={`${documentNumber} - ${title}`}>{documentNumber} - {title}</p></div> : null}<button type="button" onClick={() => { setCircleMode(false); setTextBoxMode(false); addSignature(activePlacement?.pageNumber || 1); }} disabled={!hasSignature} className="inline-flex items-center gap-2 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><PenLine className="h-4 w-4" />Sign</button><button type="button" onClick={() => { setTextBoxMode(false); setCircleMode((value) => !value); }} className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold ${circleMode ? "border-rose-600 bg-rose-600 text-white" : "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"}`} aria-pressed={circleMode} title="Circle markup tool"><span className="h-4 w-4 rounded-full border-2 border-current" />Circle</button><button type="button" onClick={() => { setCircleMode(false); setTextBoxMode((value) => !value); }} className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold ${textBoxMode ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`} aria-pressed={textBoxMode} title="Insert text box"><Type className="h-4 w-4" />Text Box</button>{textBoxMode || selectedTextBoxId ? <><div className="flex items-center gap-1">{["#0f172a", "#dc2626", "#2563eb", "#16a34a"].map((color) => <button key={color} type="button" aria-label={`Text color ${color}`} onClick={() => { setTextBoxColor(color); if (selectedTextBoxId) setTextBoxes((current) => current.map((item) => item.id === selectedTextBoxId ? { ...item, color } : item)); }} className={`h-7 w-7 rounded-full border-2 ${textBoxColor === color ? "border-slate-900" : "border-white shadow-sm"}`} style={{ backgroundColor: color }} />)}</div><select aria-label="Text box font size" value={selectedTextBoxId ? textBoxes.find((item) => item.id === selectedTextBoxId)?.fontSize || textBoxFontSize : textBoxFontSize} onChange={(event) => { const fontSize = Number(event.target.value); setTextBoxFontSize(fontSize); if (selectedTextBoxId) setTextBoxes((current) => current.map((item) => item.id === selectedTextBoxId ? { ...item, fontSize } : item)); }} className="rounded-lg border border-slate-300 px-2 py-2 text-sm"><option value="10">10 px</option><option value="12">12 px</option><option value="14">14 px</option><option value="16">16 px</option><option value="18">18 px</option><option value="24">24 px</option></select></> : null}<span className="text-sm text-slate-500">{textBoxMode ? "Drag a box around the text." : circleMode ? "Drag around content to highlight it." : hasSignature ? `${placements.length} signature placement${placements.length === 1 ? "" : "s"}` : "Save a signature in Account Settings first."}</span></div><div className="flex items-center gap-2">{batchMode ? <select aria-label="Action for this document" value={batchDecision} onChange={(event) => onBatchDecisionChange?.(event.target.value as BatchDecision)} disabled={batchSubmitting} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="APPROVE">Approve</option><option value="REJECT">Reject</option></select> : null}<button type="button" onClick={() => setZoom((value) => Math.max(0.75, value - 0.1))} className="rounded-lg border px-3 py-2 text-sm">−</button><span className="min-w-16 text-center text-sm">{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom((value) => Math.min(1.5, value + 0.1))} className="rounded-lg border px-3 py-2 text-sm">+</button>{batchMode ? <button type="button" onClick={onBatchSubmit} disabled={saving || batchSubmitting} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving || batchSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Submit all</button> : null}</div></div> : null}
        {relatedDocuments.length > 0 ? (
          <div role="tablist" aria-label="Document views" className="flex flex-wrap gap-2">
            {([
              { value: "document", label: "Document under review" },
              { value: "related", label: `Related documents (${relatedDocuments.length})` },
            ] as const).map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={viewTab === item.value}
                onClick={() => setViewTab(item.value)}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${viewTab === item.value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
        {relatedDocuments.length > 0 && viewTab === "related" ? <RelatedDocumentsPanel items={relatedDocuments} /> : null}
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div> : null}{status ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{status}</div> : null}
          <section className={`space-y-5 rounded-2xl border border-slate-200 bg-slate-950 p-4 shadow-sm ${viewTab === "related" && relatedDocuments.length > 0 ? "hidden" : ""}`}>
          {pages.map((page) => <div key={page.pageNumber} ref={(element) => { pageRefs.current[page.pageNumber] = element; }} className={`relative mx-auto overflow-visible bg-white shadow-2xl ${circleMode || textBoxMode ? "cursor-crosshair" : ""}`} style={{ width: `min(${page.width * zoom}px, calc(100vw - 2rem))`, aspectRatio: `${page.width} / ${page.height}` }} onPointerDown={(event) => { if (textBoxMode) startTextBox(event, page.pageNumber); else startCircle(event, page.pageNumber); }}><canvas ref={(element) => { canvasRefs.current[page.pageNumber] = element; }} className="absolute inset-0 h-full w-full" />{circles.filter((item) => item.pageNumber === page.pageNumber && item.width > 0 && item.height > 0).map((item) => <div key={item.id} className="absolute rounded-[50%] border-2 border-rose-600 bg-rose-200/10" style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.width}%`, height: `${item.height}%`, pointerEvents: "none" }}><button type="button" aria-label="Delete circle" title="Delete circle" className="pointer-events-auto absolute -right-2 -top-7 rounded bg-rose-700 p-1 text-white" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setCircles((current) => current.filter((value) => value.id !== item.id)); }}><Trash2 className="h-3 w-3" /></button></div>)}{textBoxes.filter((item) => item.pageNumber === page.pageNumber && item.width > 0 && item.height > 0).map((item) => <div key={item.id} className={`absolute border border-slate-300 bg-white/70 ${selectedTextBoxId === item.id ? "ring-2 ring-slate-900" : ""}`} style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.width}%`, height: `${item.height}%`, touchAction: "none" }} onPointerDown={(event) => { event.stopPropagation(); setSelectedTextBoxId(item.id); }}><textarea value={item.text} onChange={(event) => setTextBoxes((current) => current.map((value) => value.id === item.id ? { ...value, text: event.target.value } : value))} placeholder="Text" className="h-full w-full resize-none border-0 bg-transparent p-1 outline-none" style={{ color: item.color, fontSize: `${item.fontSize}px` }} /><button type="button" aria-label="Remove text box" className="absolute -right-2 -top-7 rounded bg-rose-600 p-1 text-white" onPointerDown={(event) => event.stopPropagation()} onClick={() => { setSelectedTextBoxId(null); setTextBoxes((current) => current.filter((value) => value.id !== item.id)); }}><Trash2 className="h-3 w-3" /></button></div>)}{placements.filter((item) => item.pageNumber === page.pageNumber).map((item) => <div key={item.id} className="absolute border-2 border-cyan-500 bg-cyan-100/10" style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.width}%`, height: `${item.height}%`, touchAction: "none", transform: `rotate(${item.rotation}deg)` }} onPointerDown={(event) => startDrag(event, item, "drag")}><img src={signatureUrl || ""} alt="Saved signature" className="h-full w-full select-none object-fill" draggable={false} /><button type="button" aria-label="Rotate signature" title="Rotate signature" className="absolute -left-2 -top-7 rounded bg-cyan-700 p-1 text-white" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setPlacements((current) => current.map((value) => value.id === item.id ? { ...value, rotation: (value.rotation + 90) % 360 } : value)); }}><RotateCw className="h-3 w-3" /></button><button type="button" aria-label="Resize signature" className="absolute -bottom-2 -right-2 h-5 w-5 rounded-full border-2 border-white bg-cyan-700" onPointerDown={(event) => startDrag(event, item, "resize")} /><button type="button" aria-label="Remove signature placement" className="absolute -right-2 -top-7 rounded bg-rose-600 p-1 text-white" onClick={() => setPlacements((current) => current.filter((value) => value.id !== item.id))}><Trash2 className="h-3 w-3" /></button></div>)}</div>)}
        </section>
      </div>
    </main>
  );
}
