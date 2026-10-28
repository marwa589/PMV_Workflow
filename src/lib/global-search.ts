import "server-only";

import type { Prisma } from "@prisma/client";
import { buildDocumentVisibilityWhere } from "@/lib/auth/access";
import type { UserTypeCode } from "@/lib/auth/roles";
import { getDocumentStatusDisplay } from "@/lib/document-status";
import { prisma } from "@/lib/prisma";

export type SearchHit = {
  id: string;
  documentNumber: string;
  title: string;
  status: string;
  statusLabel: string;
  typeName: string;
  subtypeName: string | null;
  projectLabel: string | null;
  createdAt: string;
};

export const SEARCH_MIN_LENGTH = 2;

/**
 * Searches EVERY document the person may open (their own, the ones a flow names them for, and everything inside
 * the scope of a role that lets them view documents), not just the page they are on.
 * Reference documents are included only when they hold "View reference documents" for them (the shared
 * visibility rule hides them from everyone else).
 * Every word typed must match the number, title, description, type, sub type, project or a field value.
 */
export async function searchDocuments(
  user: { userId: string; userType: UserTypeCode },
  query: string,
  limit: number,
): Promise<{ hits: SearchHit[]; total: number }> {
  const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (query.trim().length < SEARCH_MIN_LENGTH || terms.length === 0) return { hits: [], total: 0 };

  const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });
  const visibility = await buildDocumentVisibilityWhere(user);
  const where: Prisma.DocumentWhereInput = {
    AND: [
      visibility,
      ...terms.map(
        (term): Prisma.DocumentWhereInput => ({
          OR: [
            { documentNumber: contains(term) },
            { title: contains(term) },
            { description: contains(term) },
            { documentType: { name: contains(term) } },
            { documentType: { code: contains(term) } },
            { documentSubtype: { name: contains(term) } },
            { project: { code: contains(term) } },
            { project: { name: contains(term) } },
            { fieldValues: { some: { valueText: contains(term) } } },
          ],
        }),
      ),
    ],
  };

  const [rows, total] = await Promise.all([
    prisma.document.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        documentNumber: true,
        title: true,
        status: true,
        currentWorkflowStep: true,
        createdAt: true,
        documentType: { select: { name: true } },
        documentSubtype: { select: { name: true } },
        project: { select: { code: true, name: true } },
      },
    }),
    prisma.document.count({ where }),
  ]);

  return {
    total,
    hits: rows.map((row) => ({
      id: row.id,
      documentNumber: row.documentNumber,
      title: row.title,
      status: row.status,
      statusLabel: getDocumentStatusDisplay(row.status, { levelNumber: row.currentWorkflowStep }),
      typeName: row.documentType.name,
      subtypeName: row.documentSubtype?.name ?? null,
      projectLabel: row.project ? `${row.project.code} - ${row.project.name}` : null,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
