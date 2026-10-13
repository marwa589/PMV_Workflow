import "server-only";

import type { ApproverType } from "@prisma/client";
import type { Db } from "@/lib/auth/access";

export type FlowStepEntry = {
  approverType: ApproverType;
  userId: string | null;
  userTypeId: string | null;
};

export type ResolvedFlow =
  | { kind: "auto"; assignmentId: string | null }
  | {
      kind: "flow";
      assignmentId: string;
      template: {
        id: string;
        code: string;
        name: string;
        steps: Array<{ stepNumber: number; name: string | null; approvers: FlowStepEntry[] }>;
      };
    };

/**
 * Which approval flow does a document get? Most specific matching assignment wins (confirmed order):
 *   1. project + sub type   2. project + type   3. sub type (all projects)   4. type (all projects)
 * No match, or a matching row with no flow, means the document is auto-approved on upload.
 */
export async function resolveFlow(
  db: Db,
  ctx: { documentTypeId: string; documentSubtypeId: string | null; projectId: string | null },
): Promise<ResolvedFlow> {
  const subtypeFilter = ctx.documentSubtypeId
    ? [{ documentSubtypeId: null }, { documentSubtypeId: ctx.documentSubtypeId }]
    : [{ documentSubtypeId: null }];

  const rows = await db.documentWorkflowAssignment.findMany({
    where: { documentTypeId: ctx.documentTypeId, OR: subtypeFilter },
    select: { id: true, documentSubtypeId: true, projectId: true, templateId: true },
  });

  const matching = rows.filter((row) => row.projectId === null || row.projectId === ctx.projectId);

  const rank = (row: { documentSubtypeId: string | null; projectId: string | null }) => {
    if (row.projectId && row.documentSubtypeId) return 1;
    if (row.projectId) return 2;
    if (row.documentSubtypeId) return 3;
    return 4;
  };

  const best = [...matching].sort((a, b) => rank(a) - rank(b))[0];
  if (!best || !best.templateId) {
    return { kind: "auto", assignmentId: best?.id ?? null };
  }

  const template = await db.documentWorkflowTemplate.findUnique({
    where: { id: best.templateId },
    select: {
      id: true,
      code: true,
      name: true,
      steps: {
        orderBy: { stepNumber: "asc" },
        select: {
          stepNumber: true,
          name: true,
          approvers: { select: { approverType: true, userId: true, userTypeId: true } },
        },
      },
    },
  });

  if (!template) return { kind: "auto", assignmentId: best.id };

  return { kind: "flow", assignmentId: best.id, template };
}
