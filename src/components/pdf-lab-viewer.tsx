"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Download, Loader2, Save, Upload } from "lucide-react";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.25;
const DEFAULT_TEXT_SIZE = { width: 240, height: 96 };
const DEFAULT_HIGHLIGHT_SIZE = { width: 180, height: 80 };
const DEFAULT_DRAW_PAD = 8;
const DRAW_COLORS = [
  { label: "Slate", value: "#0f172a" },
  { label: "Red", value: "#ef4444" },
  { label: "Blue", value: "#2563eb" },
  { label: "Green", value: "#16a34a" },
  { label: "Purple", value: "#7c3aed" },
];

type Tool = "select" | "highlight" | "text" | "draw";

type Point = {
  x: number;
  y: number;
};

type RectPct = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type BaseAnnotation = {
  id: string;
  pageNumber: number;
};

type HighlightAnnotation = BaseAnnotation & {
  kind: "highlight";
  rect: RectPct;
};

type TextAnnotation = BaseAnnotation & {
  kind: "text";
  rect: RectPct;
  text: string;
};

type DrawAnnotation = BaseAnnotation & {
  kind: "draw";
  rect: RectPct;
  points: Point[];
  color: string;
  strokeWidth: number;
};

type Annotation = HighlightAnnotation | TextAnnotation | DrawAnnotation;

type DraftHighlight = {
  kind: "highlight";
  start: Point;
  current: Point;
};

type DraftDraw = {
  kind: "draw";
  points: Point[];
  color: string;
  strokeWidth: number;
};

type Draft = DraftHighlight | DraftDraw | null;

type PdfLabSnapshot = {
  version: 1;
  savedAt: number;
  annotations: Annotation[];
};

function isPdfFile(file: File | null): boolean {
  if (!file) {
    return false;
  }

  const normalizedName = file.name.toLowerCase();
  return file.type === "application/pdf" || normalizedName.endsWith(".pdf");
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function pointFromEvent(event: ReactMouseEvent<HTMLDivElement>, rect: DOMRect): Point {
  return {
    x: clampPercent(((event.clientX - rect.left) / rect.width) * 100),
    y: clampPercent(((event.clientY - rect.top) / rect.height) * 100),
  };
}

function rectFromPoints(start: Point, end: Point): RectPct {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  return { x, y, width, height };
}

function rectPxToPct(rect: { x: number; y: number; width: number; height: number }, renderSize: { width: number; height: number }): RectPct {
  const width = renderSize.width || 1;
  const height = renderSize.height || 1;
  return {
    x: clampPercent((rect.x / width) * 100),
    y: clampPercent((rect.y / height) * 100),
    width: clampPercent((rect.width / width) * 100),
    height: clampPercent((rect.height / height) * 100),
  };
}

function rectPctToPx(rect: RectPct, renderSize: { width: number; height: number }) {
  return {
    x: (rect.x / 100) * renderSize.width,
    y: (rect.y / 100) * renderSize.height,
    width: (rect.width / 100) * renderSize.width,
    height: (rect.height / 100) * renderSize.height,
  };
}

function normalizePoints(points: Point[], bounds: { x: number; y: number; width: number; height: number }): Point[] {
  const safeWidth = bounds.width || 1;
  const safeHeight = bounds.height || 1;
  return points.map((point) => ({
    x: ((point.x - bounds.x) / safeWidth) * 100,
    y: ((point.y - bounds.y) / safeHeight) * 100,
  }));
}

function denormalizePoints(points: Point[]) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function padDrawBounds(points: Point[], pad: number) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    x: minX - pad,
    y: minY - pad,
    width: Math.max(40, maxX - minX + pad * 2),
    height: Math.max(24, maxY - minY + pad * 2),
  };
}

function makeStorageKey(file: File | null) {
  if (!file) {
    return null;
  }

  return `pdf-lab:snapshot:${file.name}:${file.size}:${file.lastModified}`;
}

function readSnapshot(key: string | null): PdfLabSnapshot | null {
  if (!key || typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as PdfLabSnapshot;
    if (parsed?.version !== 1 || !Array.isArray(parsed.annotations)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writeSnapshot(key: string | null, snapshot: PdfLabSnapshot) {
  if (!key || typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(snapshot));
}

export default function PdfLabViewer() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"idle" | "loading" | "ready" | "unsupported">("idle");
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [renderSize, setRenderSize] = useState({ width: 0, height: 0 });
  const [pageRect, setPageRect] = useState({ width: 0, height: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [drawColor, setDrawColor] = useState(DRAW_COLORS[0]?.value || "#0f172a");
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [draft, setDraft] = useState<Draft>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savedStatus, setSavedStatus] = useState<string | null>(null);

  const storageKey = useMemo(() => makeStorageKey(selectedFile), [selectedFile]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const updateWidth = () => {
      setContainerWidth(element.clientWidth);
    };

    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      setPreviewMode("idle");
      setPageCount(0);
      setPageNumber(1);
      setZoom(1);
      setFileName(null);
      setError(null);
      setIsLoading(false);
      setRenderSize({ width: 0, height: 0 });
      setPageRect({ width: 0, height: 0 });
      setAnnotations([]);
      setDraft(null);
      setSelectedId(null);
      setSavedStatus(null);
      return;
    }

    const isPdf = isPdfFile(selectedFile);
    setFileName(selectedFile.name);
    setDraft(null);
    setSelectedId(null);
    setSavedStatus(null);
    setError(null);
    setRenderSize({ width: 0, height: 0 });

    if (!isPdf) {
      setPreviewUrl(null);
      setPreviewMode("unsupported");
      setPageCount(0);
      setPageNumber(1);
      setZoom(1);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setPreviewMode("loading");

    const nextUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(nextUrl);
    setPageCount(1);
    setPageNumber(1);
    setZoom(1);
    setPreviewMode("ready");
    setIsLoading(false);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [selectedFile, storageKey]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }

    const selectedAnnotation = annotations.find((annotation) => annotation.id === selectedId);
    if (!selectedAnnotation || selectedAnnotation.kind !== "text") {
      return;
    }

    const timer = window.setTimeout(() => {
      const editor = stageRef.current?.querySelector<HTMLTextAreaElement>(`[data-text-editor="${selectedId}"]`);
      if (!editor) {
        return;
      }

      editor.focus();
      editor.selectionStart = editor.value.length;
      editor.selectionEnd = editor.value.length;
    }, 0);

    return () => window.clearTimeout(timer);
  }, [annotations, selectedId]);

  useEffect(() => {
    setDraft(null);
  }, [pageNumber]);

  useEffect(() => {
    if (!stageRef.current) {
      return;
    }

    const updateRenderSize = () => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (rect?.width && rect?.height) {
        setRenderSize({ width: rect.width, height: rect.height });
        const iframe = stageRef.current?.querySelector("iframe") as HTMLIFrameElement | null;
        if (iframe) {
          const iframeRect = iframe.getBoundingClientRect();
          setPageRect({ width: iframeRect.width || rect.width, height: iframeRect.height || rect.height });
        } else {
          setPageRect({ width: rect.width, height: rect.height });
        }
      }
    };

    updateRenderSize();

    const observer = new ResizeObserver(updateRenderSize);
    observer.observe(stageRef.current);

    window.addEventListener("resize", updateRenderSize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateRenderSize);
    };
  }, [selectedFile, previewUrl, pageNumber, containerWidth]);

  const currentPageAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.pageNumber === pageNumber),
    [annotations, pageNumber],
  );

  const canGoPrevious = pageNumber > 1;
  const canGoNext = pageCount > 0 && pageNumber < pageCount;

  function removeAnnotation(annotationId: string) {
    setAnnotations((current) => current.filter((annotation) => annotation.id !== annotationId));
    setSelectedId((current) => (current === annotationId ? null : current));
  }

  function finalizeDraft() {
    if (!draft || !stageRef.current || !renderSize.width || !renderSize.height) {
      setDraft(null);
      return;
    }

    if (draft.kind === "highlight") {
      const bounds = rectFromPoints(draft.start, draft.current);
      if (bounds.width < 0.5 || bounds.height < 0.5) {
        setDraft(null);
        return;
      }

      setAnnotations((current) => [
        ...current,
        {
          id: makeId(),
          pageNumber,
          kind: "highlight",
          rect: rectPxToPct(
            {
              x: (bounds.x / 100) * renderSize.width,
              y: (bounds.y / 100) * renderSize.height,
              width: (bounds.width / 100) * renderSize.width,
              height: (bounds.height / 100) * renderSize.height,
            },
            renderSize,
          ),
        },
      ]);
      setDraft(null);
      return;
    }

    if (draft.points.length < 2) {
      setDraft(null);
      return;
    }

    const bounds = padDrawBounds(draft.points, DEFAULT_DRAW_PAD);
    const normalizedPoints = normalizePoints(draft.points, bounds);

    setAnnotations((current) => [
      ...current,
      {
        id: makeId(),
        pageNumber,
        kind: "draw",
        rect: rectPxToPct(bounds, renderSize),
        points: normalizedPoints,
        color: draft.color,
        strokeWidth: draft.strokeWidth,
      },
    ]);
    setDraft(null);
  }

  function handleStageMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || !stageRef.current) {
      return;
    }

    const rect = stageRef.current.getBoundingClientRect();
    const point = pointFromEvent(event, rect);

    if (tool === "highlight") {
      setDraft({ kind: "highlight", start: point, current: point });
      return;
    }

    if (tool === "draw") {
      setDraft({ kind: "draw", points: [point], color: drawColor, strokeWidth });
      return;
    }

    if (tool === "text") {
      const rectPx = {
        x: (point.x / 100) * renderSize.width,
        y: (point.y / 100) * renderSize.height,
        width: DEFAULT_TEXT_SIZE.width,
        height: DEFAULT_TEXT_SIZE.height,
      };

      const id = makeId();
      setAnnotations((current) => [
        ...current,
        {
          id,
          pageNumber,
          kind: "text",
          rect: rectPxToPct(rectPx, renderSize),
          text: "",
        },
      ]);
      setSelectedId(id);
      return;
    }

  }

  function handleStageMouseMove(event: ReactMouseEvent<HTMLDivElement>) {
    if (!draft || !stageRef.current) {
      return;
    }

    const rect = stageRef.current.getBoundingClientRect();
    const point = pointFromEvent(event, rect);

    if (draft.kind === "highlight") {
      setDraft({ ...draft, current: point });
      return;
    }

    const lastPoint = draft.points[draft.points.length - 1];
    if (!lastPoint) {
      return;
    }

    if (Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) < 0.2) {
      return;
    }

    setDraft({ ...draft, points: [...draft.points, point] });
  }

  function saveLocally() {
    if (!storageKey) {
      return;
    }

    const snapshot: PdfLabSnapshot = {
      version: 1,
      savedAt: Date.now(),
      annotations,
    };

    try {
      writeSnapshot(storageKey, snapshot);
      setSavedStatus(`Saved locally at ${new Intl.DateTimeFormat("en-US", { timeStyle: "short", dateStyle: "medium" }).format(snapshot.savedAt)}`);
    } catch {
      setSavedStatus("Unable to save locally.");
    }
  }

  async function downloadSnapshot() {
    if (!selectedFile || !isPdfFile(selectedFile)) {
      setSavedStatus("Upload a PDF first before downloading.");
      return;
    }

    try {
      const pdfBytes = await selectedFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const safeName = selectedFile.name.replace(/\.pdf$/i, "");
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      for (const annotation of annotations) {
        const page = pdfDoc.getPage(annotation.pageNumber - 1);
        if (!page) {
          continue;
        }

        const { width: pageWidth, height: pageHeight } = page.getSize();
        const rectLeftPx = (annotation.rect.x / 100) * pageWidth;
        const rectTopPx = (annotation.rect.y / 100) * pageHeight;
        const rectWidth = (annotation.rect.width / 100) * pageWidth;
        const rectHeight = (annotation.rect.height / 100) * pageHeight;

        if (annotation.kind === "highlight") {
          page.drawRectangle({
            x: rectLeftPx,
            y: pageHeight - rectTopPx - rectHeight,
            width: rectWidth,
            height: rectHeight,
            color: rgb(1, 0.95, 0.35),
            opacity: 0.45,
          });
          continue;
        }

        if (annotation.kind === "draw") {
          const points = annotation.points;
          for (let index = 1; index < points.length; index += 1) {
            const previous = points[index - 1];
            const current = points[index];
            const previousX = rectLeftPx + (previous.x / 100) * rectWidth;
            const previousY = pageHeight - (rectTopPx + (previous.y / 100) * rectHeight);
            const currentX = rectLeftPx + (current.x / 100) * rectWidth;
            const currentY = pageHeight - (rectTopPx + (current.y / 100) * rectHeight);

            page.drawLine({
              start: { x: previousX, y: previousY },
              end: { x: currentX, y: currentY },
              thickness: annotation.strokeWidth * 0.6,
              color: rgb(
                Number.parseInt(annotation.color.slice(1, 3), 16) / 255,
                Number.parseInt(annotation.color.slice(3, 5), 16) / 255,
                Number.parseInt(annotation.color.slice(5, 7), 16) / 255,
              ),
            });
          }
          continue;
        }

        if (annotation.kind === "text") {
          page.drawText(annotation.text, {
            x: rectLeftPx + 4,
            y: pageHeight - rectTopPx - 20,
            size: 14,
            font,
            color: rgb(0.1, 0.1, 0.1),
          });
        }
      }

      const outputBytes = await pdfDoc.save();
      const pdfBuffer = new Uint8Array(outputBytes);
      const blob = new Blob([pdfBuffer], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = `${safeName}-annotated.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setSavedStatus("Downloaded annotated PDF.");
    } catch {
      setSavedStatus("Unable to download annotated PDF.");
    }
  }

  function clearAllAnnotations() {
    setAnnotations([]);
    setSelectedId(null);
    setDraft(null);
    setSavedStatus(null);
  }

  function deleteSelected() {
    if (!selectedId) {
      return;
    }

    removeAnnotation(selectedId);
  }

  function updateText(annotationId: string, text: string) {
    setAnnotations((current) =>
      current.map((annotation) =>
        annotation.id === annotationId && annotation.kind === "text" ? { ...annotation, text } : annotation,
      ),
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Standalone Sandbox</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">PDF Annotation Lab</h1>
            <p className="mt-1 text-sm text-slate-600">
              Upload a PDF and review it with local annotations and browser-side editing only.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700">
              <Upload className="h-4 w-4" />
              <span>{fileName ? "Replace PDF" : "Upload PDF"}</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(event) => {
                  setSelectedFile(event.target.files?.[0] || null);
                  setError(null);
                  setSavedStatus(null);
                }}
              />
            </label>

          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="rounded-full bg-slate-100 px-3 py-1">No auth</span>
          <span className="rounded-full bg-slate-100 px-3 py-1">No database</span>
          <span className="rounded-full bg-slate-100 px-3 py-1">No workflow integration</span>
          <span className="rounded-full bg-slate-100 px-3 py-1">Local only</span>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
          <div className="text-sm text-slate-600">
            {fileName ? <span className="font-medium text-slate-900">{fileName}</span> : "Upload a PDF to begin."}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={saveLocally}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              Save
            </button>
            <button
              type="button"
              onClick={downloadSnapshot}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-4 w-4" />
              Download
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 text-sm text-slate-600 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-700">Draw Color</span>
            <div className="flex items-center gap-1">
              {DRAW_COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  title={color.label}
                  onClick={() => setDrawColor(color.value)}
                  className={`h-7 w-7 rounded-full border-2 transition ${
                    drawColor === color.value ? "border-slate-900" : "border-white shadow-sm"
                  }`}
                  style={{ backgroundColor: color.value }}
                />
              ))}
            </div>
          </div>

          <label className="flex items-center gap-3">
            <span className="font-medium text-slate-700">Stroke Width</span>
            <input
              type="range"
              min={2}
              max={12}
              step={1}
              value={strokeWidth}
              onChange={(event) => setStrokeWidth(Number(event.target.value))}
              className="w-40"
            />
            <span className="w-8 text-right font-medium text-slate-700">{strokeWidth}px</span>
          </label>
        </div>

        {savedStatus ? (
          <div className="border-b border-slate-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900 sm:px-5">
            {savedStatus}
          </div>
        ) : null}

        <div ref={containerRef} className="w-full bg-slate-100 p-3 sm:p-5">
          <div className="mx-auto w-full max-w-6xl rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
            {isLoading ? (
              <div className="flex min-h-[420px] items-center justify-center gap-3 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading PDF…
              </div>
            ) : error ? (
              <div className="flex min-h-[420px] flex-col items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-6 text-center text-sm text-amber-800">
                <p className="font-medium">The file was selected successfully.</p>
                <p className="mt-2 text-amber-700">Preview is shown below using the browser’s native PDF viewer.</p>
                <p className="mt-2 text-xs text-amber-700">{error}</p>
              </div>
            ) : previewUrl && isPdfFile(selectedFile) ? (
              <div ref={stageRef} className="relative mx-auto w-full max-w-5xl overflow-hidden rounded-xl border border-slate-200 bg-slate-950">
                <iframe src={previewUrl} title={fileName || "PDF preview"} className="h-[720px] w-full" />

                <div
                  className="absolute inset-0 z-20"
                  onMouseDown={handleStageMouseDown}
                  onMouseMove={handleStageMouseMove}
                  onMouseUp={finalizeDraft}
                  onMouseLeave={finalizeDraft}
                  style={{
                    cursor: tool === "select" ? "default" : tool === "text" ? "text" : "crosshair",
                    pointerEvents: tool === "select" ? "none" : "auto",
                  }}
                >
                  {currentPageAnnotations.map((annotation) => {
                    const rectPx = rectPctToPx(annotation.rect, { width: pageRect.width || renderSize.width, height: pageRect.height || renderSize.height });
                    const selected = selectedId === annotation.id;

                    return (
                      <div
                        key={annotation.id}
                        className={`annotation-shell absolute ${selected ? "outline outline-2 outline-slate-900" : ""}`}
                        style={{
                          left: `${rectPx.x}px`,
                          top: `${rectPx.y}px`,
                          width: `${rectPx.width}px`,
                          height: `${rectPx.height}px`,
                          zIndex: selected ? 40 : 30,
                        }}
                        onMouseDown={(event: ReactMouseEvent<HTMLDivElement>) => {
                          event.stopPropagation();
                          setSelectedId(annotation.id);
                        }}
                        onClick={(event: ReactMouseEvent<HTMLDivElement>) => {
                          event.stopPropagation();
                          setSelectedId(annotation.id);
                        }}
                      >
                        <div className="relative h-full w-full">
                          {annotation.kind === "highlight" ? (
                            <div className="h-full w-full rounded-md bg-yellow-300/40 ring-1 ring-yellow-400/80" />
                          ) : null}

                          {annotation.kind === "draw" ? (
                            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible">
                              <path
                                d={denormalizePoints(annotation.points)}
                                fill="none"
                                stroke={annotation.color}
                                strokeWidth={annotation.strokeWidth}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                vectorEffect="non-scaling-stroke"
                              />
                            </svg>
                          ) : null}

                          {annotation.kind === "text" ? (
                            <textarea
                              data-text-editor={annotation.id}
                              value={annotation.text}
                              onChange={(event) => updateText(annotation.id, event.target.value)}
                              onFocus={() => setSelectedId(annotation.id)}
                              placeholder="Type note"
                              className="annotation-editor h-full w-full resize-none rounded-none border-none bg-transparent p-0 text-sm leading-5 text-slate-900 outline-none placeholder:text-slate-400"
                              style={{ boxShadow: "none", minHeight: "100%" }}
                            />
                          ) : null}

                          {selected ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                removeAnnotation(annotation.id);
                              }}
                              className="annotation-action absolute -right-2 -top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-rose-600 text-white shadow-md hover:bg-rose-500"
                              aria-label="Delete annotation"
                            >
                              ×
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}

                  {draft?.kind === "highlight" ? (
                    <div
                      className="absolute rounded-md bg-yellow-300/35 ring-1 ring-yellow-400/80"
                      style={{
                        ...(() => {
                          const bounds = rectFromPoints(draft.start, draft.current);
                          const pxRect = {
                            x: (bounds.x / 100) * renderSize.width,
                            y: (bounds.y / 100) * renderSize.height,
                            width: (bounds.width / 100) * renderSize.width,
                            height: (bounds.height / 100) * renderSize.height,
                          };
                          return pxRect;
                        })(),
                        pointerEvents: "none",
                      }}
                    />
                  ) : null}

                  {draft?.kind === "draw" ? (
                    <svg
                      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                    >
                      <path
                        d={denormalizePoints(draft.points)}
                        fill="none"
                        stroke={draft.color}
                        strokeWidth={draft.strokeWidth}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex min-h-[420px] items-center justify-center text-sm text-slate-500">
                Upload a PDF to begin.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
