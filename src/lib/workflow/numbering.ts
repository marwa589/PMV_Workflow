import "server-only";

import { Prisma } from "@prisma/client";

/**
 * Builds the next document number from the type's naming pattern, e.g. {TYPE}-{PROJECT}-{YYYY}-{SEQ:4}
 * gives MR-P1-2026-0007. One counter per type + project + year, incremented atomically in the database.
 * A document with no project drops the {PROJECT} part.
 */
export async function generateDocumentNumber(
  tx: Prisma.TransactionClient,
  input: { documentTypeId: string; projectId: string | null; date?: Date },
): Promise<string> {
  const date = input.date ?? new Date();
  const year = date.getUTCFullYear();

  const type = await tx.documentType.findUnique({
    where: { id: input.documentTypeId },
    select: { code: true, namingPattern: true },
  });
  if (!type) throw new Error("Document type not found.");

  const project = input.projectId
    ? await tx.project.findUnique({ where: { id: input.projectId }, select: { code: true } })
    : null;

  const rows = await tx.$queryRaw<Array<{ lastValue: number }>>(Prisma.sql`
    INSERT INTO "DocumentNumberCounter" ("id", "documentTypeId", "projectId", "periodYear", "lastValue")
    VALUES (gen_random_uuid()::text, ${input.documentTypeId}::text, ${input.projectId}::text, ${year}::int, 1)
    ON CONFLICT ("documentTypeId", (COALESCE("projectId", '')), "periodYear")
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
    .replace(/\{TYPE\}/g, type.code)
    .replace(/\{PROJECT\}/g, project?.code ?? "")
    .replace(/\{YYYY\}/g, String(year))
    .replace(/\{SEQ:(\d+)\}/g, (_match, width: string) => String(sequence).padStart(Number(width), "0"))
    .replace(/\{SEQ\}/g, String(sequence));
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
