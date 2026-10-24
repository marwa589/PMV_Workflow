// src/app/approver/review-batch/page.tsx
import { DocumentStatus } from "@prisma/client";
import { redirect } from "next/navigation";
import BatchDocumentReview from "@/components/batch-document-review";
import { requireAuth } from "@/lib/auth/guards";
import { userHasPermissionForDocument } from "@/lib/auth/access";
import { BULK_APPROVE_MAX } from "@/lib/bulk-approve-config";
import { userCanBulkApprove } from "@/lib/bulk-approve";
import { getActionableDocuments } from "@/lib/document-queries";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Opens several pending documents together. Only for users an admin switched "approve several at once" on for.
export default async function ReviewBatchPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const session = await requireAuth();
  if (!(await userCanBulkApprove(session.userId))) redirect("/unauthorized");

  const { ids } = await searchParams;
  const wanted = [...new Set((ids ?? "").split(",").map((id) => id.trim()).filter(Boolean))].slice(0, BULK_APPROVE_MAX);
  if (wanted.length === 0) redirect("/tasks");

  // Never trust the ids in the link: keep only documents that are waiting for this person right now.
  const waiting = await getActionableDocuments({ userId: session.userId, userType: session.userType }, [DocumentStatus.PENDING]);
  const byId = new Map(waiting.map((row) => [row.id, row]));
  const rows = wanted.map((id) => byId.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row));
  if (rows.length === 0) redirect("/tasks");

  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { signaturePath: true } });

  const items = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      documentNumber: row.documentNumber,
      title: row.title,
      downloadUrl: `/api/documents/${row.id}/download?version=${row.currentVersion}`,
      actionUrl: `/api/documents/${row.id}/actions`,
      allowNoSignature: await userHasPermissionForDocument(session, "documents.approve_without_signature", {
        projectId: row.project?.id ?? null,
        documentTypeId: row.documentType.id,
        documentSubtypeId: row.documentSubtype?.id ?? null,
      }),
    })),
  );

  return <BatchDocumentReview items={items} hasSignature={Boolean(user?.signaturePath)} returnUrl="/tasks" />;
}
