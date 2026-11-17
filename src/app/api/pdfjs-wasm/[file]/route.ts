// src/app/api/pdfjs-wasm/[file]/route.ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Helper files the PDF viewer (pdfjs) loads on demand. Scanned documents (Canon / Xerox / Ricoh copiers) keep their text
// as CCITT / JBIG2 / JPEG 2000 images, and those are decoded by these files. Without them the viewer silently leaves
// that content out, so the page looks half empty although the file itself is fine. They are served from the installed
// pdfjs-dist package, so they always match the viewer's version.
const FILES: Record<string, string> = {
  "jbig2.wasm": "application/wasm",
  "jbig2_nowasm_fallback.js": "text/javascript",
  "openjpeg.wasm": "application/wasm",
  "openjpeg_nowasm_fallback.js": "text/javascript",
  "qcms_bg.wasm": "application/wasm",
  "quickjs-eval.wasm": "application/wasm",
  "quickjs-eval.js": "text/javascript",
};

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const contentType = FILES[file];
  if (!contentType) return NextResponse.json({ message: "Not found." }, { status: 404 });

  try {
    const bytes = await readFile(path.join(process.cwd(), "node_modules", "pdfjs-dist", "wasm", file));
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=86400" },
    });
  } catch {
    return NextResponse.json({ message: "Not found." }, { status: 404 });
  }
}
