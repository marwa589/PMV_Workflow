import { NextResponse } from "next/server";
import { DocumentStatus, Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { canViewPurchaseOrdersSidebar, isOmar, resolvePurchaseOrderRecipients } from "@/lib/po-access";
import { savePurchaseOrderFile, deleteDocumentFiles } from "@/lib/files";
import { validateCsrf } from "@/lib/csrf";
import { queuePurchaseOrderAvailableEvents } from "@/lib/workflow-email-batching";
import { purchaseOrderStorageFolder } from "@/lib/storage-layout";

export const runtime = "nodejs";

function nextPoNumber(nextNumber: number) {
  return `PO-${String(nextNumber).padStart(6, "0")}`;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (!canViewPurchaseOrdersSidebar(session.role)) return NextResponse.json({ message: "Forbidden" }, { status: 403 });

  const location = new URL(request.url).searchParams.get("location");
  const mrs = await prisma.document.findMany({
    where: {
      documentType: "MATERIAL_REQUISITION",
      status: DocumentStatus.APPROVED,
      ...(location === "AVR" || location === "AVK" || location === "KUWAIT" ? { createdBy: { location } } : {}),
    },
    select: { id: true, documentNumber: true, title: true, mrNumber: true },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ mrs });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (!isOmar(session)) return NextResponse.json({ message: "Only Omar can create purchase orders." }, { status: 403 });
  if (!validateCsrf(request)) return NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 });

  const formData = await request.formData();
  const description = String(formData.get("description") || "").trim();
  const requestedLocation = String(formData.get("location") || "").trim().toUpperCase();
  const fileMrIdsValue = String(formData.get("fileMrIds") || "[]");
  const files = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);

  let fileMrIds: string[];
  try {
    const parsed = JSON.parse(fileMrIdsValue);
    fileMrIds = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    fileMrIds = [];
  }

  if (files.length === 0) return NextResponse.json({ message: "Select at least one PO file." }, { status: 400 });
  if (fileMrIds.length !== files.length || fileMrIds.some((id) => !id)) return NextResponse.json({ message: "Select a related approved MR for every PO file." }, { status: 400 });

  const approvedMrs = await prisma.document.findMany({
    where: {
      id: { in: [...new Set(fileMrIds)] },
      documentType: "MATERIAL_REQUISITION",
      status: DocumentStatus.APPROVED,
      ...(requestedLocation === "AVR" || requestedLocation === "AVK" || requestedLocation === "KUWAIT" ? { createdBy: { location: requestedLocation } } : {}),
    },
    select: { id: true, createdBy: { select: { email: true, location: true } } },
  });
  if (approvedMrs.length !== new Set(fileMrIds).size) {
    return NextResponse.json({ message: requestedLocation ? "Every related MR must be approved and belong to the selected location." : "Every related MR must be approved." }, { status: 400 });
  }
  const mrUploaderEmails = new Map(approvedMrs.map((mr) => [mr.id, mr.createdBy.email]));

  const savedPaths: string[] = [];
  try {
    const result = await prisma.$transaction(async (tx) => {
      const created: Array<{ id: string; poNumber: string; originalName: string }> = [];

      for (const [fileIndex, file] of files.entries()) {
        const mrUploaderEmail = mrUploaderEmails.get(fileMrIds[fileIndex]);
        const saved = await savePurchaseOrderFile(
          file,
          mrUploaderEmail ? purchaseOrderStorageFolder(mrUploaderEmail) : "POs",
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
            description: description || null,
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
