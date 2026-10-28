import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deactivationConfirmationResponse, prismaErrorResponse, readJsonBody, requireApiPermission, str } from "@/lib/admin-api";
import { nodesOverlap } from "@/lib/workflow/processes";

export const runtime = "nodejs";

const MAX_NODES = 100;

const processSelect = {
  id: true,
  name: true,
  description: true,
  isActive: true,
  currentVersion: true,
  createdAt: true,
  steps: {
    orderBy: { stepNumber: "asc" },
    select: {
      id: true,
      stepNumber: true,
      name: true,
      parentStepId: true,
      versionNumber: true,
      documentTypeId: true,
      documentSubtypeId: true,
      delayHours: true,
      referenceDocumentTypeId: true,
      referenceDocumentSubtypeId: true,
      referenceDocumentType: { select: { id: true, code: true, name: true } },
      referenceDocumentSubtype: { select: { id: true, code: true, name: true } },
      documentType: { select: { id: true, code: true, name: true } },
      documentSubtype: { select: { id: true, code: true, name: true } },
    },
  },
  _count: { select: { instances: true } },
} as const;

type ParsedNode = {
  key: string;
  parentKey: string | null;
  name: string;
  documentTypeId: string;
  documentSubtypeId: string | null;
  referenceDocumentTypeId: string | null;
  referenceDocumentSubtypeId: string | null;
  delayHours: number;
};

type OrderedNode = ParsedNode & { stepNumber: number };

/**
 * A process is a tree of document nodes. The request sends a flat list: every node has a key, and every node
 * except the single root names its parent's key. Each node asks for one document of a type, or of a specific
 * sub type. The children of a node are the optional choices for what comes next; the uploader picks one.
 * Validates the shape and returns the nodes numbered 1..n in depth-first order (root = 1).
 */
async function parseTree(raw: unknown): Promise<{ nodes?: OrderedNode[]; error?: string }> {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "A process needs at least a starting document." };
  if (raw.length > MAX_NODES) return { error: `A process can have at most ${MAX_NODES} documents.` };

  const parsed: ParsedNode[] = [];
  const keys = new Set<string>();
  for (const [index, item] of raw.entries()) {
    const record = (item ?? {}) as Record<string, unknown>;
    const key = str(record.key);
    const parentKey = str(record.parentKey) || null;
    const documentTypeId = str(record.documentTypeId);
    const documentSubtypeId = str(record.documentSubtypeId) || null;
    const name = str(record.name);
    if (!key || keys.has(key)) return { error: `Document ${index + 1} has a missing or repeated key.` };
    if (!name || !documentTypeId) return { error: `Document ${index + 1} needs a name and a document type.` };
    keys.add(key);

    const type = await prisma.documentType.findUnique({ where: { id: documentTypeId }, select: { id: true } });
    if (!type) return { error: `${name}: the document type does not exist.` };
    if (documentSubtypeId && !(await prisma.documentSubtype.findFirst({ where: { id: documentSubtypeId, documentTypeId }, select: { id: true } }))) {
      return { error: `${name}: the sub type does not belong to the document type.` };
    }

    // Optional reference document (a type, or a sub type of it) the uploader of this step may attach.
    const referenceDocumentTypeId = str(record.referenceDocumentTypeId) || null;
    const referenceDocumentSubtypeId = referenceDocumentTypeId ? str(record.referenceDocumentSubtypeId) || null : null;
    if (referenceDocumentTypeId) {
      if (!(await prisma.documentType.findUnique({ where: { id: referenceDocumentTypeId }, select: { id: true } }))) {
        return { error: `${name}: the reference document type does not exist.` };
      }
      if (referenceDocumentSubtypeId && !(await prisma.documentSubtype.findFirst({ where: { id: referenceDocumentSubtypeId, documentTypeId: referenceDocumentTypeId }, select: { id: true } }))) {
        return { error: `${name}: the reference document sub type does not belong to its document type.` };
      }
    }

    // Waiting period (hours) after the PARENT document is finally approved. Any whole number of hours; 0 = none.
    const rawDelay = record.delayHours === undefined || record.delayHours === null || record.delayHours === "" ? 0 : Number(record.delayHours);
    if (!Number.isInteger(rawDelay) || rawDelay < 0 || rawDelay > 8760) {
      return { error: `${name}: the waiting period must be a whole number of hours between 0 and 8760.` };
    }
    parsed.push({ key, parentKey, name, documentTypeId, documentSubtypeId, referenceDocumentTypeId, referenceDocumentSubtypeId, delayHours: rawDelay });
  }

  const roots = parsed.filter((node) => node.parentKey === null);
  if (roots.length !== 1) return { error: "A process must have exactly one starting (root) document." };
  if (roots[0].delayHours > 0) return { error: "The starting document cannot have a waiting period: there is no earlier document to wait for." };
  for (const node of parsed) {
    if (node.parentKey !== null && !keys.has(node.parentKey)) return { error: `${node.name}: its parent document does not exist.` };
    if (node.parentKey === node.key) return { error: `${node.name} cannot follow itself.` };
  }

  // Walk the tree from the root (depth-first): numbers the nodes and proves there are no loops or detached branches.
  const childrenOf = new Map<string, ParsedNode[]>();
  for (const node of parsed) {
    if (node.parentKey === null) continue;
    childrenOf.set(node.parentKey, [...(childrenOf.get(node.parentKey) ?? []), node]);
  }

  const ordered: OrderedNode[] = [];
  const visit = (node: ParsedNode) => {
    ordered.push({ ...node, stepNumber: ordered.length + 1 });
    for (const child of childrenOf.get(node.key) ?? []) visit(child);
  };
  visit(roots[0]);
  if (ordered.length !== parsed.length) return { error: "Every document must connect to the starting document (no loops or detached branches)." };

  // The choices after one document must be different documents, otherwise the uploader could not tell them apart.
  for (const [parentKey, children] of childrenOf) {
    for (const [i, a] of children.entries()) {
      for (const b of children.slice(i + 1)) {
        if (nodesOverlap(a, b)) {
          const parent = parsed.find((node) => node.key === parentKey);
          return { error: `The choices after "${parent?.name}" ("${a.name}" and "${b.name}") ask for the same kind of document. Each choice must be different.` };
        }
      }
    }
  }

  return { nodes: ordered };
}

/** One active process per root document type: uploading that document starts exactly one tree. */
async function rootConflict(definitionId: string | null, root: { documentTypeId: string; documentSubtypeId: string | null }): Promise<string | null> {
  const others = await prisma.processDefinition.findMany({
    where: { isActive: true, ...(definitionId ? { id: { not: definitionId } } : {}) },
    select: {
      name: true,
      currentVersion: true,
      steps: { where: { parentStepId: null }, select: { versionNumber: true, documentTypeId: true, documentSubtypeId: true } },
    },
  });
  for (const other of others) {
    // Only the current version counts (older versions just keep their running work going), and old linear
    // processes (several "roots") can never run as trees.
    const roots = other.steps.filter((step) => step.versionNumber === other.currentVersion);
    if (roots.length === 1 && nodesOverlap(roots[0], root)) {
      return `The active process "${other.name}" already starts with this document type. Only one active process can start with the same document.`;
    }
  }
  return null;
}

/** The screens show (and edit) the current version of each tree; older versions only exist for runs that started on them. */
function currentVersionOnly<T extends { currentVersion: number; steps: Array<{ versionNumber: number }> }>(process: T): T {
  return { ...process, steps: process.steps.filter((step) => step.versionNumber === process.currentVersion) };
}

async function createNodes(tx: Prisma.TransactionClient, processDefinitionId: string, versionNumber: number, nodes: OrderedNode[]) {
  // Parents come before their children in depth-first order, so each parent's real id is known when needed.
  const idByKey = new Map<string, string>();
  for (const node of nodes) {
    const created = await tx.processStep.create({
      data: {
        processDefinitionId,
        versionNumber,
        stepNumber: node.stepNumber,
        name: node.name,
        documentTypeId: node.documentTypeId,
        documentSubtypeId: node.documentSubtypeId,
        referenceDocumentTypeId: node.referenceDocumentTypeId,
        referenceDocumentSubtypeId: node.referenceDocumentSubtypeId,
        delayHours: node.delayHours,
        parentStepId: node.parentKey ? idByKey.get(node.parentKey) ?? null : null,
      },
      select: { id: true },
    });
    idByKey.set(node.key, created.id);
  }
}

export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "processes.manage");
  if (auth.response) return auth.response;

  const [processes, documentTypes] = await Promise.all([
    prisma.processDefinition.findMany({ select: processSelect, orderBy: { name: "asc" } }),
    prisma.documentType.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, subtypes: { where: { isActive: true }, select: { id: true, code: true, name: true } } },
      orderBy: { name: "asc" },
    }),
  ]);
  return NextResponse.json({ processes: processes.map(currentVersionOnly), documentTypes });
}

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "processes.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const name = str(body?.name);
  if (!name) return NextResponse.json({ message: "Process name is required." }, { status: 400 });

  const parsed = await parseTree(body?.steps);
  if (parsed.error || !parsed.nodes) return NextResponse.json({ message: parsed.error }, { status: 400 });

  const isActive = body?.isActive === undefined ? true : Boolean(body.isActive);
  if (isActive) {
    const conflict = await rootConflict(null, parsed.nodes[0]);
    if (conflict) return NextResponse.json({ message: conflict }, { status: 409 });
  }

  try {
    const id = await prisma.$transaction(async (tx) => {
      const definition = await tx.processDefinition.create({
        data: { name, description: str(body?.description) || null, isActive },
        select: { id: true },
      });
      await createNodes(tx, definition.id, 1, parsed.nodes as OrderedNode[]);
      return definition.id;
    });
    const process = await prisma.processDefinition.findUnique({ where: { id }, select: processSelect });
    return NextResponse.json({ process: process ? currentVersionOnly(process) : process }, { status: 201 });
  } catch (error) {
    return prismaErrorResponse(error, { duplicate: "A process with this name already exists." })
      ?? NextResponse.json({ message: "Unable to create the process." }, { status: 500 });
  }
}

// Editing the tree of a process that already has runs creates a new version: running and finished runs keep the
// version they started with, and every new upload follows the new one.
export async function PATCH(request: Request) {
  const auth = await requireApiPermission(request, "processes.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const id = str(body?.id);
  const name = str(body?.name);
  if (!id || !name) return NextResponse.json({ message: "Process id and name are required." }, { status: 400 });

  const existing = await prisma.processDefinition.findUnique({
    where: { id },
    select: { isActive: true, currentVersion: true, steps: { select: { parentStepId: true, versionNumber: true, documentTypeId: true, documentSubtypeId: true } } },
  });
  if (!existing) return NextResponse.json({ message: "Record not found." }, { status: 404 });

  const runs = await prisma.processInstance.count({ where: { processDefinitionId: id } });
  let nodes: OrderedNode[] | undefined;
  if (body?.steps !== undefined) {
    const parsed = await parseTree(body.steps);
    if (parsed.error || !parsed.nodes) return NextResponse.json({ message: parsed.error }, { status: 400 });
    nodes = parsed.nodes;
  }

  const willBeActive = typeof body?.isActive === "boolean" ? body.isActive : existing.isActive;
  if (willBeActive) {
    const root = nodes ? nodes[0] : (() => {
      const roots = existing.steps.filter((step) => step.parentStepId === null && step.versionNumber === existing.currentVersion);
      return roots.length === 1 ? roots[0] : null;
    })();
    if (!root) {
      return NextResponse.json(
        { message: "This is an old linear process (it has no starting document and follow-up choices), so it cannot be active. Rebuild it as a tree." },
        { status: 409 },
      );
    }
    const conflict = await rootConflict(id, root);
    if (conflict) return NextResponse.json({ message: conflict }, { status: 409 });
  }

  try {
    if (body?.isActive === false) {
      const [inProgressRuns, assignmentCounts] = await Promise.all([
        prisma.processInstance.count({ where: { processDefinitionId: id, status: "IN_PROGRESS" } }),
        prisma.processDefinition.findUnique({
          where: { id },
          select: { isActive: true, _count: { select: { scopedAssignments: true, assignmentScopes: true } } },
        }),
      ]);
      if (assignmentCounts?.isActive) {
        const confirmation = deactivationConfirmationResponse(body, "This process", [
          { label: "existing run(s)", count: runs },
          { label: "currently running process(es)", count: inProgressRuns },
          { label: "role assignment(s)", count: assignmentCounts._count.scopedAssignments + assignmentCounts._count.assignmentScopes },
        ]);
        if (confirmation) return confirmation;
      }
    }

    await prisma.$transaction(async (tx) => {
      let nextVersion = existing.currentVersion;
      if (nodes) {
        if (runs > 0) {
          // Runs already exist: keep the old tree exactly as it is (they keep following it) and add the edited tree
          // as a new version. Every new upload uses the new version.
          nextVersion = existing.currentVersion + 1;
        } else {
          await tx.processStep.deleteMany({ where: { processDefinitionId: id } });
        }
        await createNodes(tx, id, nextVersion, nodes);
      }
      await tx.processDefinition.update({
        where: { id },
        data: {
          currentVersion: nextVersion,
          name,
          description: str(body?.description) || null,
          ...(typeof body?.isActive === "boolean" ? { isActive: body.isActive } : {}),
        },
      });
    });
    const process = await prisma.processDefinition.findUnique({ where: { id }, select: processSelect });
    return NextResponse.json({ process: process ? currentVersionOnly(process) : process });
  } catch (error) {
    return prismaErrorResponse(error, { duplicate: "A process with this name already exists." })
      ?? NextResponse.json({ message: "Unable to update the process." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiPermission(request, "processes.manage");
  if (auth.response) return auth.response;

  const id = str((await readJsonBody(request))?.id);
  if (!id) return NextResponse.json({ message: "Process id is required." }, { status: 400 });

  try {
    await prisma.processDefinition.delete({ where: { id } });
    return NextResponse.json({ message: "Process deleted." });
  } catch (error) {
    return prismaErrorResponse(error, { reference: "This process already has runs. Deactivate it instead." })
      ?? NextResponse.json({ message: "Unable to delete the process." }, { status: 500 });
  }
}
