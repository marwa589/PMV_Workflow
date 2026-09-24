import { UserRole } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import DocumentReviewEditor from "@/components/document-review-editor";
import { requireRole } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ApproverDocumentReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole([UserRole.APPROVER_1, UserRole.APPROVER_2, UserRole.APPROVER_3]);
  const { id } = await params;
  const document = await prisma.document.findUnique({
    where: { id },
    select: {
      id: true,
      documentNumber: true,
      title: true,
      currentApproverId: true,
      currentVersion: true,
      documentType: true,
      createdBy: { select: { location: true } },
      versions: { where: { versionNumber: { equals: 0 } }, select: { id: true } },
      createdById: true,
    },
  });

  if (!document) notFound();
  if (document.currentApproverId !== session.userId) redirect("/unauthorized");

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { email: true, signaturePath: true },
  });

  const allowNoSignature = [
    "mohammad.mehieddine@ahmadiah.com",
    "joemar.paraiso@ahmadiah.com",
  ].includes(user?.email?.trim().toLowerCase() || "");
  const isGeorgeAvrOrAvkMr = user?.email?.trim().toLowerCase() === "george.azzi@ahmadiah.com"
    && document.documentType === "MATERIAL_REQUISITION"
    && (document.createdBy.location === "AVR" || document.createdBy.location === "AVK");

  return (
    <DocumentReviewEditor
      documentId={document.id}
      documentNumber={document.documentNumber}
      title={document.title}
      hasSignature={Boolean(user?.signaturePath)}
      allowNoSignature={allowNoSignature || isGeorgeAvrOrAvkMr}
    />
  );
}
