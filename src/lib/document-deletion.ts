import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deleteDocumentFiles } from "@/lib/files";

/**
 * Permanently removes documents and everything that hangs off them. A document that sits in a process run is
 * taken out of the run (the run itself carries on). Returns the stored file paths so the caller can remove
 * the files from disk after the transaction commits.
 */
export async function deleteDocumentRecords(tx: Prisma.TransactionClient, documentIds: string[]): Promise<string[]> {
  if (documentIds.length === 0) return [];

  const versions = await tx.documentVersion.findMany({
    where: { documentId: { in: documentIds } },
    select: { filePath: true },
  });

  await tx.processStepDocument.deleteMany({ where: { documentId: { in: documentIds } } });
  await tx.approvalHistory.deleteMany({ where: { documentId: { in: documentIds } } });
  await tx.emailNotificationEvent.deleteMany({ where: { documentId: { in: documentIds } } });
  await tx.notification.deleteMany({ where: { documentId: { in: documentIds } } });
  await tx.document.deleteMany({ where: { id: { in: documentIds } } });

  return versions.map((version) => version.filePath);
}

export async function deleteDocumentsPermanently(documentIds: string[]): Promise<number> {
  const filePaths = await prisma.$transaction((tx) => deleteDocumentRecords(tx, documentIds));
  await deleteDocumentFiles({ filePaths });
  return documentIds.length;
}
