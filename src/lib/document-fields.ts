import "server-only";

import { FieldDataType, FieldGroup, Prisma } from "@prisma/client";
import type { Db } from "@/lib/auth/access";
import { WorkflowError } from "@/lib/workflow/errors";

// Custom fields are configured per document type / sub type by an admin (FieldDefinition).
// This module turns what a form submits into rows for DocumentFieldValue, and rejects bad input.

export type FieldInput = Record<string, unknown>;

export type FieldDefinitionRow = {
  id: string;
  fieldGroup: FieldGroup;
  fieldKey: string;
  label: string;
  dataType: FieldDataType;
  isRequired: boolean;
  options: Prisma.JsonValue | null;
};

export type NormalizedValue = {
  fieldDefinitionId: string;
  valueText: string | null;
  valueNumber: Prisma.Decimal | null;
  valueDate: Date | null;
  valueBoolean: boolean | null;
  valueJson: Prisma.InputJsonValue | null;
};

export type NormalizedFields = { header: NormalizedValue[]; lines: NormalizedValue[][] };

const MAX_TEXT = 500;
const MAX_LONG_TEXT = 10000;
const MAX_LINE_ITEMS = 500;

/** Active fields that apply to a type, including those set for "every sub type" (no sub type). */
export async function loadFieldDefinitions(
  db: Db,
  documentTypeId: string,
  documentSubtypeId: string | null,
): Promise<FieldDefinitionRow[]> {
  return db.fieldDefinition.findMany({
    where: {
      documentTypeId,
      isActive: true,
      OR: documentSubtypeId ? [{ documentSubtypeId: null }, { documentSubtypeId }] : [{ documentSubtypeId: null }],
    },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: { id: true, fieldGroup: true, fieldKey: true, label: true, dataType: true, isRequired: true, options: true },
  });
}

/** Select options are stored as a list of strings, or of { value, label } objects. */
export function optionValues(options: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(options)) return [];
  return options
    .map((option) => {
      if (typeof option === "string") return option;
      if (option && typeof option === "object" && "value" in option) return String((option as { value: unknown }).value);
      return null;
    })
    .filter((value): value is string => value !== null);
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0);
}

function emptyValue(fieldDefinitionId: string): NormalizedValue {
  return { fieldDefinitionId, valueText: null, valueNumber: null, valueDate: null, valueBoolean: null, valueJson: null };
}

function normalizeOne(definition: FieldDefinitionRow, raw: unknown): NormalizedValue {
  const result = emptyValue(definition.id);
  const fail = (message: string): never => {
    throw new WorkflowError(`${definition.label}: ${message}`, 400);
  };

  switch (definition.dataType) {
    case FieldDataType.TEXT:
    case FieldDataType.LONG_TEXT: {
      const text = String(raw).trim();
      const limit = definition.dataType === FieldDataType.TEXT ? MAX_TEXT : MAX_LONG_TEXT;
      if (text.length > limit) fail(`must be at most ${limit} characters.`);
      result.valueText = text;
      break;
    }
    case FieldDataType.NUMBER: {
      const text = String(raw).trim();
      if (!/^-?\d+(\.\d+)?$/.test(text)) fail("must be a number.");
      result.valueNumber = new Prisma.Decimal(text);
      break;
    }
    case FieldDataType.DATE: {
      const text = String(raw).trim();
      const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00.000Z`) : null;
      if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) fail("must be a date (YYYY-MM-DD).");
      result.valueDate = parsed;
      break;
    }
    case FieldDataType.BOOLEAN: {
      if (raw === true || raw === "true" || raw === "on") result.valueBoolean = true;
      else if (raw === false || raw === "false" || raw === "off") result.valueBoolean = false;
      else fail("must be yes or no.");
      break;
    }
    case FieldDataType.SELECT: {
      const value = String(raw);
      if (!optionValues(definition.options).includes(value)) fail("is not one of the allowed choices.");
      result.valueText = value;
      break;
    }
    case FieldDataType.MULTI_SELECT: {
      const values = Array.isArray(raw) ? raw.map(String) : [];
      const allowed = optionValues(definition.options);
      if (values.length === 0 || values.some((value) => !allowed.includes(value))) fail("contains a choice that is not allowed.");
      result.valueJson = values;
      break;
    }
  }

  return result;
}

function normalizeGroup(definitions: FieldDefinitionRow[], input: FieldInput, where: string): NormalizedValue[] {
  const known = new Set(definitions.map((definition) => definition.fieldKey));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) throw new WorkflowError(`${where}: unknown field "${key}".`, 400);
  }

  const values: NormalizedValue[] = [];
  for (const definition of definitions) {
    const raw = input[definition.fieldKey];
    if (isEmpty(raw)) {
      if (definition.isRequired) throw new WorkflowError(`${where}${definition.label} is required.`, 400);
      continue;
    }
    values.push(normalizeOne(definition, raw));
  }
  return values;
}

/**
 * Validates the header fields (once per document) and, for types that carry an item table, each line.
 * Throws WorkflowError(400) with a readable message on the first problem.
 */
export function normalizeFieldValues(
  definitions: FieldDefinitionRow[],
  header: FieldInput,
  lineItems: FieldInput[],
  supportsLineItems: boolean,
): NormalizedFields {
  if (!supportsLineItems && lineItems.length > 0) {
    throw new WorkflowError("This document type does not take line items.", 400);
  }
  if (lineItems.length > MAX_LINE_ITEMS) {
    throw new WorkflowError(`A document can have at most ${MAX_LINE_ITEMS} line items.`, 400);
  }

  const headerDefinitions = definitions.filter((definition) => definition.fieldGroup === FieldGroup.HEADER);
  const lineDefinitions = definitions.filter((definition) => definition.fieldGroup === FieldGroup.LINE_ITEM);

  return {
    header: normalizeGroup(headerDefinitions, header, ""),
    lines: lineItems.map((line, index) => normalizeGroup(lineDefinitions, line, `Line ${index + 1}: `)),
  };
}

/** Parses the JSON a form sends: { "fieldKey": value } for the header and [{ "fieldKey": value }] for lines. */
export function parseFieldInputs(rawHeader: FormDataEntryValue | null, rawLines: FormDataEntryValue | null): { header: FieldInput; lineItems: FieldInput[] } {
  const parse = (raw: FormDataEntryValue | null, label: string): unknown => {
    if (typeof raw !== "string" || raw.trim() === "") return null;
    try {
      return JSON.parse(raw);
    } catch {
      throw new WorkflowError(`${label} is not valid.`, 400);
    }
  };

  const header = parse(rawHeader, "Field values") ?? {};
  const lines = parse(rawLines, "Line items") ?? [];

  const isObject = (value: unknown): value is FieldInput => typeof value === "object" && value !== null && !Array.isArray(value);
  if (!isObject(header)) throw new WorkflowError("Field values are not valid.", 400);
  if (!Array.isArray(lines) || !lines.every(isObject)) throw new WorkflowError("Line items are not valid.", 400);

  return { header, lineItems: lines };
}

/** Writes the values (and line items) for a document inside the caller's transaction. */
export async function saveFieldValues(tx: Prisma.TransactionClient, documentId: string, fields: NormalizedFields): Promise<void> {
  const toRow = (value: NormalizedValue, lineItemId: string | null) => ({
    documentId,
    fieldDefinitionId: value.fieldDefinitionId,
    lineItemId,
    valueText: value.valueText,
    valueNumber: value.valueNumber,
    valueDate: value.valueDate,
    valueBoolean: value.valueBoolean,
    valueJson: value.valueJson ?? Prisma.JsonNull,
  });

  if (fields.header.length > 0) {
    await tx.documentFieldValue.createMany({ data: fields.header.map((value) => toRow(value, null)) });
  }

  for (const [index, line] of fields.lines.entries()) {
    const lineItem = await tx.documentLineItem.create({ data: { documentId, lineNo: index + 1 } });
    if (line.length > 0) {
      await tx.documentFieldValue.createMany({ data: line.map((value) => toRow(value, lineItem.id)) });
    }
  }
}
