import "server-only";

import { Prisma } from "@prisma/client";

/**
 * Subtyped documents use type + subtype + year counters. Other documents retain the type + project + year pattern.
 */
export async function generateDocumentNumber(
  tx: Prisma.TransactionClient,
  input: { documentTypeId: string; documentSubtypeId?: string | null; projectId: string | null; date?: Date },
): Promise<string> {
  const date = input.date ?? new Date();
  const year = date.getUTCFullYear();

  const type = await tx.documentType.findUnique({
    where: { id: input.documentTypeId },
    select: { code: true, numberingCode: true, namingPattern: true },
  });
  if (!type) throw new Error("Document type not found.");

  if (input.documentSubtypeId) {
    const subtype = await tx.documentSubtype.findFirst({
      where: { id: input.documentSubtypeId, documentTypeId: input.documentTypeId },
      select: { code: true, numberingCode: true },
    });
    if (!subtype) throw new Error("Document sub type not found for the selected document type.");

    const rows = await tx.$queryRaw<Array<{ lastValue: number }>>(Prisma.sql`
      INSERT INTO "DocumentNumberCounter" ("id", "documentTypeId", "documentSubtypeId", "projectId", "periodYear", "lastValue")
      VALUES (gen_random_uuid()::text, ${input.documentTypeId}::text, ${input.documentSubtypeId}::text, NULL, ${year}::int, 1)
      ON CONFLICT ("documentTypeId", (COALESCE("documentSubtypeId", '')), (COALESCE("projectId", '')), "periodYear")
      DO UPDATE SET "lastValue" = "DocumentNumberCounter"."lastValue" + 1
      RETURNING "lastValue"
    `);
    const sequence = rows[0]?.lastValue;
    if (!sequence) throw new Error("Could not allocate a document number.");

    return `${type.numberingCode || type.code}-${subtype.numberingCode || subtype.code}-${year}-${String(sequence).padStart(4, "0")}`;
  }

  const project = input.projectId
    ? await tx.project.findUnique({ where: { id: input.projectId }, select: { code: true } })
    : null;

  const rows = await tx.$queryRaw<Array<{ lastValue: number }>>(Prisma.sql`
    INSERT INTO "DocumentNumberCounter" ("id", "documentTypeId", "projectId", "periodYear", "lastValue")
    VALUES (gen_random_uuid()::text, ${input.documentTypeId}::text, ${input.projectId}::text, ${year}::int, 1)
    ON CONFLICT ("documentTypeId", (COALESCE("documentSubtypeId", '')), (COALESCE("projectId", '')), "periodYear")
    DO UPDATE SET "lastValue" = "DocumentNumberCounter"."lastValue" + 1
    RETURNING "lastValue"
  `);

  const sequence = rows[0]?.lastValue;
  if (!sequence) throw new Error("Could not allocate a document number.");

  let pattern = type.namingPattern;
  if (!project) {
    pattern = pattern.replace(/-?\{PROJECT\}-?/, (match) => (match.startsWith("-") && match.endsWith("-") ? "-" : ""));
  }

  return pattern
    .replace(/\{TYPE\}/g, type.numberingCode || type.code)
    .replace(/\{PROJECT\}/g, project?.code ?? "")
    .replace(/\{YYYY\}/g, String(year))
    .replace(/\{SEQ:(\d+)\}/g, (_match, width: string) => String(sequence).padStart(Number(width), "0"))
    .replace(/\{SEQ\}/g, String(sequence));
}

export async function renumberSubtypeDocuments(
  tx: Prisma.TransactionClient,
  input: { documentTypeId: string; documentSubtypeId?: string },
): Promise<void> {
  const where = input.documentSubtypeId
    ? Prisma.sql`"documentTypeId" = ${input.documentTypeId} AND "documentSubtypeId" = ${input.documentSubtypeId}`
    : Prisma.sql`"documentTypeId" = ${input.documentTypeId} AND "documentSubtypeId" IS NOT NULL`;
  const type = await tx.documentType.findUniqueOrThrow({
    where: { id: input.documentTypeId },
    select: { code: true, numberingCode: true },
  });
  const documents = await tx.document.findMany({
    where: input.documentSubtypeId
      ? { documentTypeId: input.documentTypeId, documentSubtypeId: input.documentSubtypeId }
      : { documentTypeId: input.documentTypeId, documentSubtypeId: { not: null } },
    select: {
      id: true,
      documentNumber: true,
      createdAt: true,
      documentSubtypeId: true,
      documentSubtype: { select: { code: true, numberingCode: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const subtypeIds = [...new Set(documents.map((document) => document.documentSubtypeId).filter((id): id is string => id !== null))];
  const existingCounters = subtypeIds.length > 0
    ? await tx.documentNumberCounter.findMany({
        where: { documentTypeId: input.documentTypeId, documentSubtypeId: { in: subtypeIds }, projectId: null },
        select: { documentSubtypeId: true, periodYear: true, lastValue: true },
      })
    : [];
  const nextSequences = new Map<string, number>();
  const counters = new Map<string, { documentSubtypeId: string; periodYear: number; lastValue: number }>();
  const sequencesByScope = new Map<string, Set<number>>();
  for (const counter of existingCounters) {
    if (counter.documentSubtypeId) {
      const scope = `${counter.documentSubtypeId}:${counter.periodYear}`;
      nextSequences.set(scope, counter.lastValue);
      counters.set(scope, {
        documentSubtypeId: counter.documentSubtypeId,
        periodYear: counter.periodYear,
        lastValue: counter.lastValue,
      });
    }
  }
  const documentSequences = new Map<string, { scope: string; sequence: number; year: number }>();
  for (const document of documents) {
    if (!document.documentSubtypeId) throw new Error("Cannot number a document without its sub type.");
    const year = document.createdAt.getUTCFullYear();
    const scope = `${document.documentSubtypeId}:${year}`;
    const match = /-(\d+)$/.exec(document.documentNumber);
    const sequence = match ? Number(match[1]) : NaN;
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error(`Cannot preserve the sequence in document number ${document.documentNumber}.`);
    const usedSequences = sequencesByScope.get(scope) ?? new Set<number>();
    if (usedSequences.has(sequence)) throw new Error(`Duplicate sequence ${sequence} in subtype numbering scope ${scope}.`);
    usedSequences.add(sequence);
    sequencesByScope.set(scope, usedSequences);
    documentSequences.set(document.id, { scope, sequence, year });
    nextSequences.set(scope, Math.max(nextSequences.get(scope) ?? 0, sequence));
  }

  const tempPrefix = `__renumber_${crypto.randomUUID()}__`;
  await tx.$executeRaw(Prisma.sql`
    UPDATE "Document"
    SET "documentNumber" = ${tempPrefix} || "id"
    WHERE ${where}
  `);

  for (const document of documents) {
    if (!document.documentSubtypeId || !document.documentSubtype) throw new Error("Cannot number a document without its sub type.");
    const numbering = documentSequences.get(document.id);
    if (!numbering) throw new Error(`Cannot preserve the sequence for document ${document.id}.`);
    const { scope, sequence, year } = numbering;
    counters.set(scope, { documentSubtypeId: document.documentSubtypeId, periodYear: year, lastValue: nextSequences.get(scope) ?? sequence });
    const number = `${type.numberingCode || type.code}-${document.documentSubtype.numberingCode || document.documentSubtype.code}-${year}-${String(sequence).padStart(4, "0")}`;
    await tx.document.update({ where: { id: document.id }, data: { documentNumber: number } });
  }

  if (subtypeIds.length > 0) {
    await tx.documentNumberCounter.deleteMany({
      where: { documentTypeId: input.documentTypeId, documentSubtypeId: { in: subtypeIds }, projectId: null },
    });
    for (const counter of counters.values()) {
      await tx.documentNumberCounter.create({
        data: {
          documentTypeId: input.documentTypeId,
          documentSubtypeId: counter.documentSubtypeId,
          projectId: null,
          periodYear: counter.periodYear,
          lastValue: counter.lastValue,
        },
      });
    }
  }
}

/**
 * A naming pattern must contain {TYPE}, {PROJECT}, {YYYY} and {SEQ} (or {SEQ:n}). The counter is kept per type,
 * project and year, so leaving any of these out would eventually give two documents the same number.
 * Returns a message when the pattern is not acceptable, otherwise null.
 */
export function validateNamingPattern(pattern: string): string | null {
  const trimmed = pattern.trim();
  if (trimmed.length === 0 || trimmed.length > 100) return "Naming pattern must be 1 to 100 characters.";

  const tokens = trimmed.match(/\{[^}]*\}/g) ?? [];
  const allowed = (token: string) => ["{TYPE}", "{PROJECT}", "{YYYY}", "{SEQ}"].includes(token) || /^\{SEQ:\d{1,2}\}$/.test(token);
  const unknown = tokens.find((token) => !allowed(token));
  if (unknown) return `Unknown token ${unknown}. Use {TYPE}, {PROJECT}, {YYYY} and {SEQ:4}.`;

  const has = (name: string) => tokens.some((token) => token === name || (name === "{SEQ}" && token.startsWith("{SEQ")));
  const missing = ["{TYPE}", "{PROJECT}", "{YYYY}", "{SEQ}"].filter((name) => !has(name));
  if (missing.length > 0) return `The naming pattern must include ${missing.join(", ")}.`;

  return null;
}
