// src/app/api/documents/package/route.ts
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { DocumentStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getSession } from "@/lib/auth/session";
import { buildDocumentVisibilityWhere } from "@/lib/auth/access";
import { validateCsrf } from "@/lib/csrf";
import { recordDownloads } from "@/lib/download-tracking";
import { resolveStoredFilePath } from "@/lib/files";
import { prisma } from "@/lib/prisma";
import { createZip, type ZipEntry } from "@/lib/zip";

export const runtime = "nodejs";

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

const cleanName = (value: string) => value.replace(/[\\/:*?"<>|\r\n]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "document";
const stripExtension = (value: string) => value.replace(/\.[^.]+$/, "");

// A4 in points; pictures are scaled down to fit and never enlarged.
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;

/** Add one stored file to the merged PDF. Returns false when the file type cannot be put into a PDF. */
async function appendToPdf(target: PDFDocument, data: Buffer, originalName: string): Promise<boolean> {
  const extension = extname(originalName).toLowerCase();
  if (extension === ".pdf") {
    const source = await PDFDocument.load(data, { ignoreEncryption: true });
    (await target.copyPages(source, source.getPageIndices())).forEach((page) => target.addPage(page));
    return true;
  }
  if (extension === ".jpg" || extension === ".jpeg" || extension === ".png") {
    const image = extension === ".png" ? await target.embedPng(data) : await target.embedJpg(data);
    const scale = Math.min(1, (PAGE_WIDTH - 40) / image.width, (PAGE_HEIGHT - 40) / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    const page = target.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawImage(image, { x: (PAGE_WIDTH - width) / 2, y: (PAGE_HEIGHT - height) / 2, width, height });
    return true;
  }
  return false;
}

/** A last page that lists what could not be merged (Word / Excel files), so nothing is left out silently. */
async function appendSkippedPage(target: PDFDocument, skipped: string[]) {
  const font = await target.embedFont(StandardFonts.Helvetica);
  const bold = await target.embedFont(StandardFonts.HelveticaBold);
  const page = target.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  // Standard PDF fonts only draw basic Latin characters, so anything else becomes "?".
  const safe = (value: string) => value.replace(/[^\x20-\x7e]/g, "?");
  let y = PAGE_HEIGHT - 60;
  page.drawText("Not included in this package", { x: 40, y, size: 14, font: bold, color: rgb(0.1, 0.1, 0.1) });
  y -= 22;
  page.drawText("These files are not PDF or picture files, so they could not be merged. Download them one by one.", { x: 40, y, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
  y -= 24;
  for (const line of skipped) {
    if (y < 50) break;
    page.drawText(safe(line).slice(0, 110), { x: 40, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
    y -= 16;
  }
}

/**
 * Download package: each requested document together with every document linked to it (the other documents of the
 * same process run), merged into ONE PDF named after the requested document's file. One requested document gives
 * that PDF directly; several give a ZIP that holds one such PDF per requested document (no folders).
 * With mode "single", the same packages are merged one after the other into ONE PDF instead: picked document, its
 * linked documents, then the next picked document and its linked documents, and so on. A linked document shared by
 * several picked documents (e.g. a comparison sheet) is repeated under each of them.
 * People only get what they could download one by one: documents they cannot see or download are left out.
 * There is no limit on how many documents can be requested.
 */
type PackageMode = "separate" | "single";

async function buildPackage(session: Session, requestedIds: string[], mode: PackageMode = "separate") {
  const ids = [...new Set(requestedIds.filter(Boolean))];
  if (ids.length === 0) return NextResponse.json({ message: "No documents selected." }, { status: 400 });

  const visibility = await buildDocumentVisibilityWhere(session, prisma, "documents.download");

  // The requested documents the person may download, in the order they were asked for.
  const found = await prisma.document.findMany({
    where: { AND: [{ id: { in: ids } }, visibility] },
    select: { id: true, documentNumber: true, title: true, currentVersion: true },
  });
  const requested = ids.flatMap((id) => found.filter((document) => document.id === id));
  if (requested.length === 0) return NextResponse.json({ message: "None of the selected documents can be downloaded." }, { status: 403 });

  // Linked documents: everything in the process run(s) each requested document belongs to.
  const links = await prisma.processStepDocument.findMany({
    where: { documentId: { in: requested.map((document) => document.id) } },
    select: { documentId: true, processInstanceId: true },
  });
  const instanceIds = [...new Set(links.map((link) => link.processInstanceId))];
  const runDocuments = instanceIds.length
    ? await prisma.processStepDocument.findMany({ where: { processInstanceId: { in: instanceIds } }, select: { documentId: true, processInstanceId: true } })
    : [];
  const runsOf = new Map<string, Set<string>>();
  for (const link of links) runsOf.set(link.documentId, (runsOf.get(link.documentId) ?? new Set()).add(link.processInstanceId));
  const membersOf = new Map<string, Set<string>>();
  for (const item of runDocuments) membersOf.set(item.processInstanceId, (membersOf.get(item.processInstanceId) ?? new Set()).add(item.documentId));

  const packageOf = new Map<string, string[]>(); // requested id -> [itself, ...linked]
  for (const document of requested) {
    const members = new Set<string>([document.id]);
    for (const instanceId of runsOf.get(document.id) ?? []) for (const id of membersOf.get(instanceId) ?? []) members.add(id);
    packageOf.set(document.id, [...members]);
  }

  const allIds = [...new Set([...packageOf.values()].flat())];
  const documents = await prisma.document.findMany({
    where: { AND: [{ id: { in: allIds } }, visibility] },
    select: { id: true, documentNumber: true, title: true, status: true, currentVersion: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const byId = new Map(documents.map((document) => [document.id, document]));

  const outputs: Array<{ name: string; data: Buffer }> = [];
  const usedNames = new Set<string>();
  const downloadedApproved = new Set<string>();
  const missing: string[] = [];
  const single = mode === "single";
  const combined = single ? await PDFDocument.create() : null;
  const fileCache = new Map<string, Buffer>(); // a shared document is read from disk once, however many packages use it
  const combinedSkipped: string[] = [];

  for (const picked of requested) {
    const members = (packageOf.get(picked.id) ?? [])
      .map((id) => byId.get(id))
      .filter((document): document is NonNullable<typeof document> => Boolean(document))
      // The picked document comes first, then everything linked to it (oldest first).
      .sort((a, b) => {
        if (a.id === picked.id) return -1;
        if (b.id === picked.id) return 1;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });

    const merged = combined ?? (await PDFDocument.create());
    const included: string[] = [];
    const skipped: string[] = [];

    for (const document of members) {
      // Every requested document gets its own full set: a document shared by several packages (e.g. one comparison
      // sheet behind several MRs) is repeated under each of them, also in the single merged file.
      const version = await prisma.documentVersion.findUnique({
        where: { documentId_versionNumber: { documentId: document.id, versionNumber: document.currentVersion } },
        select: { filePath: true, originalName: true },
      });
      if (!version) continue;
      try {
        let data = fileCache.get(version.filePath);
        if (!data) {
          data = await readFile(resolveStoredFilePath(version.filePath));
          fileCache.set(version.filePath, data);
        }
        if (await appendToPdf(merged, data, version.originalName)) {
          included.push(document.id);
        } else {
          // Listed once even when several packages hold the same file.
          const line = `${document.documentNumber} - ${version.originalName}`;
          if (!skipped.includes(line)) skipped.push(line);
        }
      } catch {
        missing.push(document.documentNumber);
      }
    }

    for (const id of included) if (byId.get(id)?.status === DocumentStatus.APPROVED) downloadedApproved.add(id);
    if (single) {
      for (const line of skipped) if (!combinedSkipped.includes(line)) combinedSkipped.push(line);
      continue;
    }
    if (merged.getPageCount() === 0) continue;
    if (skipped.length > 0) await appendSkippedPage(merged, skipped);

    // Named after the file that was picked (its uploaded name), or after its number and title when that is unknown.
    const pickedVersion = await prisma.documentVersion.findUnique({
      where: { documentId_versionNumber: { documentId: picked.id, versionNumber: picked.currentVersion } },
      select: { originalName: true },
    });
    const base = cleanName(pickedVersion ? stripExtension(pickedVersion.originalName) : `${picked.documentNumber} - ${picked.title}`);
    let name = `${base}.pdf`;
    for (let n = 2; usedNames.has(name.toLowerCase()); n += 1) name = `${base} (${n}).pdf`;
    usedNames.add(name.toLowerCase());
    outputs.push({ name, data: Buffer.from(await merged.save()) });
  }

  if (combined && combined.getPageCount() > 0) {
    if (combinedSkipped.length > 0) await appendSkippedPage(combined, combinedSkipped);
    outputs.push({ name: `documents-package-${new Date().toISOString().slice(0, 10)}.pdf`, data: Buffer.from(await combined.save()) });
  }

  if (outputs.length === 0) return NextResponse.json({ message: "No files could be read for this package." }, { status: 404 });

  try {
    await recordDownloads(session.userId, [...downloadedApproved]);
  } catch (error) {
    console.error("[document-package] Failed to record downloads", error);
  }

  const extraHeaders = { "X-Content-Type-Options": "nosniff", ...(missing.length ? { "X-Package-Missing": missing.join(",") } : {}) };

  if (outputs.length === 1) {
    const [only] = outputs;
    return new NextResponse(new Uint8Array(only.data), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="package.pdf"; filename*=UTF-8''${encodeURIComponent(only.name)}`,
        "Content-Length": String(only.data.byteLength),
        ...extraHeaders,
      },
    });
  }

  const entries: ZipEntry[] = outputs.map((output) => ({ name: output.name, data: output.data }));
  const zip = createZip(entries);
  const archiveName = `documents-package-${Date.now()}.zip`;
  return new NextResponse(new Uint8Array(zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="package.zip"; filename*=UTF-8''${encodeURIComponent(archiveName)}`,
      "Content-Length": String(zip.byteLength),
      ...extraHeaders,
    },
  });
}

// Query: ?ids=<id>&ids=<id>  (fine for a few documents; a long selection should use POST, see below)
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  return buildPackage(session, new URL(request.url).searchParams.getAll("ids"));
}

// Body: { "ids": ["<id>", ...], "mode": "separate" | "single" }. A web address can only hold so many ids, so big
// selections are sent in the body. "separate" (default): one PDF per requested document (a ZIP when there are several);
// "single": everything merged into one PDF.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (!validateCsrf(request)) return NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { ids?: unknown; mode?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
  return buildPackage(session, ids, body?.mode === "single" ? "single" : "separate");
}
