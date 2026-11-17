import { NextResponse } from "next/server";
import { DocumentStatus, Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { canViewPurchaseOrdersSidebar, isOmar, isReadyMixKhobarDirector, directorPurchaseOrderProjectNames, resolvePurchaseOrderRecipients } from "@/lib/po-access";
import { getInvoiceScopeForUser, invoiceScopeMrWhere } from "@/lib/invoice-access";
import { savePurchaseOrderFile, deleteDocumentFiles } from "@/lib/files";
import { validateCsrf } from "@/lib/csrf";
import { queuePurchaseOrderAvailableEvents } from "@/lib/workflow-email-batching";
import { purchaseOrderStorageFolder } from "@/lib/storage-layout";
import { isKsaViewer, KSA_USER_LOCATIONS } from "@/lib/ksa-viewer";
import { documentLocationWhere, effectiveDocumentLocation } from "@/lib/document-location";

export const runtime = "nodejs";

function nextPoNumber(nextNumber: number) {
  return `PO-${String(nextNumber).padStart(6, "0")}`;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (!canViewPurchaseOrdersSidebar(session)) return NextResponse.json({ message: "Forbidden" }, { status: 403 });

  const location = new URL(request.url).searchParams.get("location");
  const isReadyMixViewer = isReadyMixKhobarDirector(session);
  const invoiceScope = getInvoiceScopeForUser(session);
  const mrs = await prisma.document.findMany({
    where: {
      documentType: "MATERIAL_REQUISITION",
      status: DocumentStatus.APPROVED,
      ...(isReadyMixViewer
        ? { projectName: { in: directorPurchaseOrderProjectNames(session) } }
        : isKsaViewer(session)
          ? { createdBy: { location: { in: [...KSA_USER_LOCATIONS] } } }
        : invoiceScope
          ? invoiceScopeMrWhere(invoiceScope)
          : location === "AVR" || location === "AVK" || location === "KUWAIT" ? documentLocationWhere(location) : {}),
    },
    select: { id: true, documentNumber: true, title: true, mrNumber: true },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ mrs });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (isKsaViewer(session)) return NextResponse.json({ message: "KSA Viewer access is read-only." }, { status: 403 });
  if (!isOmar(session)) return NextResponse.json({ message: "Only Omar can create purchase orders." }, { status: 403 });
  if (!validateCsrf(request)) return NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 });

  const formData = await request.formData();
  const description = String(formData.get("description") || "").trim();
  const requestedLocation = String(formData.get("location") || "").trim().toUpperCase();
  const fileMrIdsValue = String(formData.get("fileMrIds") || "[]");
  // Optional description per file (same order as the files); an empty one falls back to the shared description.
  const fileDescriptionsValue = String(formData.get("fileDescriptions") || "[]");
  const files = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);

  let fileMrIds: string[];
  try {
    const parsed = JSON.parse(fileMrIdsValue);
    fileMrIds = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    fileMrIds = [];
  }

  let fileDescriptions: string[];
  try {
    const parsed = JSON.parse(fileDescriptionsValue);
    fileDescriptions = Array.isArray(parsed) ? parsed.map((value) => String(value ?? "").trim()) : [];
  } catch {
    fileDescriptions = [];
  }

  if (files.length === 0) return NextResponse.json({ message: "Select at least one PO file." }, { status: 400 });
  if (fileMrIds.length !== files.length || fileMrIds.some((id) => !id)) return NextResponse.json({ message: "Select a related approved MR for every PO file." }, { status: 400 });

  const approvedMrs = await prisma.document.findMany({
    where: {
      id: { in: [...new Set(fileMrIds)] },
      documentType: "MATERIAL_REQUISITION",
      status: DocumentStatus.APPROVED,
      ...(requestedLocation === "AVR" || requestedLocation === "AVK" || requestedLocation === "KUWAIT" ? documentLocationWhere(requestedLocation) : {}),
    },
    select: { id: true, projectName: true, uploaderLocation: true, createdBy: { select: { email: true, location: true } } },
  });
  if (approvedMrs.length !== new Set(fileMrIds).size) {
    return NextResponse.json({ message: requestedLocation ? "Every related MR must be approved and belong to the selected location." : "Every related MR must be approved." }, { status: 400 });
  }
  // An AVK MR's POs go to the AVK folder, also when the MR was uploaded by Erro (AVR account) on his AVK route.
  const mrStorageInfo = new Map(approvedMrs.map((mr) => [mr.id, { email: mr.createdBy.email, projectName: mr.projectName, location: effectiveDocumentLocation(mr) === "AVK" ? "AVK" : null }]));

  const savedPaths: string[] = [];
  try {
    const result = await prisma.$transaction(async (tx) => {
      const created: Array<{ id: string; poNumber: string; originalName: string }> = [];

      for (const [fileIndex, file] of files.entries()) {
        const mrStorage = mrStorageInfo.get(fileMrIds[fileIndex]);
        const saved = await savePurchaseOrderFile(
          file,
          mrStorage ? purchaseOrderStorageFolder(mrStorage.email, mrStorage.projectName, mrStorage.location) : "POs",
        );
        savedPaths.push(saved.relativePath);

        const sequence = await tx.purchaseOrderSequence.upsert({
          where: { id: 1 },
          update: { nextNumber: { increment: 1 } },
          create: { id: 1, nextNumber: 2 },
          select: { nextNumber: true },
        });
        const poNumber = nextPoNumber(sequence.nextNumber - 1);
        const po = await tx.purchaseOrder.create({
          data: {
            poNumber,
            originalName: file.name,
            description: fileDescriptions[fileIndex] || description || null,
            filePath: saved.relativePath,
            mimeType: file.type || "application/octet-stream",
            fileSize: file.size,
            uploadedById: session.userId,
            mrLinks: {
              create: [{ documentId: fileMrIds[fileIndex], createdById: session.userId }],
            },
          },
          select: { id: true, poNumber: true, originalName: true },
        });
        await resolvePurchaseOrderRecipients(tx, po.id);
        created.push(po);
      }

      return created;
    });

    await queuePurchaseOrderAvailableEvents(result.map((purchaseOrder) => purchaseOrder.id));
    return NextResponse.json({ message: `${result.length} PO(s) created.`, purchaseOrders: result }, { status: 201 });
  } catch (error) {
    if (savedPaths.length > 0) {
      await deleteDocumentFiles({ filePaths: savedPaths });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ message: "A PO file with the same filename already exists." }, { status: 409 });
    }
    if (error instanceof Error && (error.message.startsWith("Purchase order") || error.message.startsWith("A related MR"))) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    console.error("PO creation failed.", error);
    return NextResponse.json({ message: "Unable to create purchase orders." }, { status: 500 });
  }
}
