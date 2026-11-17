// src/lib/related-documents.ts
//
// The documents a reviewer sees next to the document they are reviewing ("Related documents" tab):
//  - the documents above it in its process tree, from the first document of the process down to the one it follows
//    (e.g. Quotation -> ERR, or Comparison -> MR), following follow-up runs back to the document they follow, and
//  - the reference documents attached to it and to those documents.
// Only what the person may open is returned: a document they cannot see is left out completely.

import { prisma } from "@/lib/prisma";
import { buildDocumentVisibilityWhere, getVisibleReferenceDocuments } from "@/lib/auth/access";
import type { UserTypeCode } from "@/lib/auth/roles";

export type RelatedDocument = {
  id: string;
  documentNumber: string;
  title: string;
  typeLabel: string;
  // "Tree": a document earlier in the process; "Reference": a reference document attached to `attachedTo`.
  kind: "tree" | "reference";
  // Name of the process step it filled (tree documents), e.g. "Quotation".
  stepName: string | null;
  // The document number a reference document is attached to.
  attachedTo: string | null;
  statusLabel: string;
  previewUrl: string;
  downloadUrl: string;
  fileKind: "pdf" | "image" | "other";
  originalName: string | null;
};

const MAX_DEPTH = 30;

function fileKindOf(name: string | null, mimeType: string | null): RelatedDocument["fileKind"] {
  const lower = (name ?? "").toLowerCase();
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if ((mimeType ?? "").startsWith("image/") || /\.(png|jpe?g)$/.test(lower)) return "image";
  return "other";
}

function statusText(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase().replaceAll("_", " ");
}

/** The documents above `documentId` in its process tree, first document of the process first (no visibility check). */
async function treeAncestors(documentId: string): Promise<Array<{ documentId: string; stepName: string }>> {
  const chain: Array<{ documentId: string; stepName: string }> = [];
  const seen = new Set<string>([documentId]);

  let currentDocumentId: string | null = documentId;
  for (let depth = 0; currentDocumentId && depth < MAX_DEPTH; depth += 1) {
    // The run this document sits in: its current link first (a rejected earlier link is only history).
    const link: { processInstanceId: string; processStep: { parentStepId: string | null } } | null = await prisma.processStepDocument.findFirst({
      where: { documentId: currentDocumentId },
      orderBy: [{ isCurrent: "desc" }, { linkedAt: "desc" }],
      select: { processInstanceId: true, processStep: { select: { parentStepId: true } } },
    });
    if (!link) break;

    let parentDocumentId: string | null = null;
    let parentStepName = "";
    if (link.processStep.parentStepId) {
      const parent: { documentId: string; processStep: { name: string } } | null = await prisma.processStepDocument.findFirst({
        where: { processInstanceId: link.processInstanceId, processStepId: link.processStep.parentStepId },
        orderBy: [{ isCurrent: "desc" }, { linkedAt: "desc" }],
        select: { documentId: true, processStep: { select: { name: true } } },
      });
      if (parent) {
        parentDocumentId = parent.documentId;
        parentStepName = parent.processStep.name;
      }
    } else {
      // The first document of a follow-up run follows a document of the run it came from.
      const run: { followedDocumentId: string | null } | null = await prisma.processInstance.findUnique({
        where: { id: link.processInstanceId },
        select: { followedDocumentId: true },
      });
      if (run?.followedDocumentId) {
        parentDocumentId = run.followedDocumentId;
        const parentLink: { processStep: { name: string } } | null = await prisma.processStepDocument.findFirst({
          where: { documentId: run.followedDocumentId },
          orderBy: [{ isCurrent: "desc" }, { linkedAt: "desc" }],
          select: { processStep: { select: { name: true } } },
        });
        parentStepName = parentLink?.processStep.name ?? "";
      }
    }

    if (!parentDocumentId || seen.has(parentDocumentId)) break;
    seen.add(parentDocumentId);
    chain.unshift({ documentId: parentDocumentId, stepName: parentStepName });
    currentDocumentId = parentDocumentId;
  }
  return chain;
}

export async function getRelatedDocumentsForReview(
  user: { userId: string; userType: UserTypeCode },
  documentId: string,
): Promise<RelatedDocument[]> {
  const ancestors = await treeAncestors(documentId);

  // Documents of the tree this person may open.
  const visibility = await buildDocumentVisibilityWhere(user, prisma);
  const visibleIds = ancestors.length
    ? new Set(
        (
          await prisma.document.findMany({
            where: { AND: [{ id: { in: ancestors.map((item) => item.documentId) } }, visibility] },
            select: { id: true },
          })
        ).map((row) => row.id),
      )
    : new Set<string>();
  const visibleAncestors = ancestors.filter((item) => visibleIds.has(item.documentId));

  // Reference documents: those of each visible tree document, then those of the document being reviewed.
  const owners = [...visibleAncestors.map((item) => item.documentId), documentId];
  const referencesByOwner = new Map<string, string[]>();
  for (const ownerId of owners) {
    const references = await getVisibleReferenceDocuments(user, ownerId);
    referencesByOwner.set(ownerId, references.map((reference) => reference.id));
  }

  const allIds = [...new Set([...visibleAncestors.map((item) => item.documentId), ...[...referencesByOwner.values()].flat()])];
  if (allIds.length === 0) return [];

  const rows = await prisma.document.findMany({
    where: { id: { in: [...allIds, documentId] } },
    select: {
      id: true,
      documentNumber: true,
      title: true,
      status: true,
      currentVersion: true,
      documentType: { select: { name: true } },
      documentSubtype: { select: { name: true } },
      versions: { select: { versionNumber: true, originalName: true, mimeType: true } },
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));

  const toItem = (id: string, kind: RelatedDocument["kind"], stepName: string | null, attachedTo: string | null): RelatedDocument | null => {
    const row = byId.get(id);
    if (!row) return null;
    const version = row.versions.find((candidate) => candidate.versionNumber === row.currentVersion) ?? null;
    return {
      id: row.id,
      documentNumber: row.documentNumber,
      title: row.title,
      typeLabel: `${row.documentType.name}${row.documentSubtype ? ` - ${row.documentSubtype.name}` : ""}`,
      kind,
      stepName,
      attachedTo,
      statusLabel: statusText(row.status),
      previewUrl: `/api/documents/${row.id}/download?version=${row.currentVersion}&inline=1`,
      downloadUrl: `/api/documents/${row.id}/download?version=${row.currentVersion}`,
      fileKind: fileKindOf(version?.originalName ?? null, version?.mimeType ?? null),
      originalName: version?.originalName ?? null,
    };
  };

  const result: RelatedDocument[] = [];
  const added = new Set<string>();
  const push = (item: RelatedDocument | null) => {
    if (!item || added.has(item.id) || item.id === documentId) return;
    added.add(item.id);
    result.push(item);
  };
  // Order: each tree document followed by its own reference documents, then the reviewed document's references.
  for (const ancestor of visibleAncestors) {
    push(toItem(ancestor.documentId, "tree", ancestor.stepName || null, null));
    const ownerNumber = byId.get(ancestor.documentId)?.documentNumber ?? null;
    for (const referenceId of referencesByOwner.get(ancestor.documentId) ?? []) push(toItem(referenceId, "reference", null, ownerNumber));
  }
  const reviewedNumber = byId.get(documentId)?.documentNumber ?? null;
  for (const referenceId of referencesByOwner.get(documentId) ?? []) push(toItem(referenceId, "reference", null, reviewedNumber));
  return result;
}
