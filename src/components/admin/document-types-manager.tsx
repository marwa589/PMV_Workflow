"use client";

import { useCallback, useEffect, useState } from "react";
import { callApi, callApiWithDeactivationConfirmation } from "@/lib/admin-client";
import { Banner, Card, Empty, Field, Pill, dangerButton, inputClass, primaryButton, secondaryButton } from "@/components/admin/admin-ui";

type Subtype = { id: string; code: string; numberingCode: string; name: string; isActive: boolean };
type DocType = {
  id: string;
  code: string;
  numberingCode: string;
  name: string;
  description: string | null;
  namingPattern: string;
  supportsLineItems: boolean;
  isActive: boolean;
  subtypes: Subtype[];
  _count: { fieldDefinitions: number; documents: number };
};
type FieldRow = {
  id: string;
  documentTypeId: string;
  documentSubtypeId: string | null;
  fieldGroup: "HEADER" | "LINE_ITEM";
  fieldKey: string;
  label: string;
  dataType: string;
  isRequired: boolean;
  options: unknown;
  sortOrder: number;
  isActive: boolean;
};

const DATA_TYPES = [
  ["TEXT", "Text"],
  ["LONG_TEXT", "Long text"],
  ["NUMBER", "Number"],
  ["DATE", "Date"],
  ["BOOLEAN", "Yes / No"],
  ["SELECT", "Choose one"],
  ["MULTI_SELECT", "Choose several"],
] as const;

const DEFAULT_PATTERN = "{TYPE}-{PROJECT}-{YYYY}-{SEQ:4}";
const blankType = { code: "", numberingCode: "", name: "", description: "", namingPattern: DEFAULT_PATTERN, supportsLineItems: false };
const blankField = { documentSubtypeId: "", fieldGroup: "HEADER", fieldKey: "", label: "", dataType: "TEXT", isRequired: false, options: "", sortOrder: 0 };

function optionsText(options: unknown): string {
  return Array.isArray(options) ? options.map((o) => (typeof o === "string" ? o : String((o as { value?: unknown }).value ?? ""))).join(", ") : "";
}

/** Document types, their sub types, and the custom fields each one collects. Nothing here needs a code change. */
export default function DocumentTypesManager() {
  const [types, setTypes] = useState<DocType[]>([]);
  const [fields, setFields] = useState<FieldRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [typeForm, setTypeForm] = useState(blankType);
  const [typeEditId, setTypeEditId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [subtypeForm, setSubtypeForm] = useState({ code: "", numberingCode: "", name: "" });
  const [subtypeEditId, setSubtypeEditId] = useState<string | null>(null);
  const [fieldForm, setFieldForm] = useState(blankField);
  const [fieldEditId, setFieldEditId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [t, f] = await Promise.all([
      callApi<{ documentTypes: DocType[] }>("/api/admin/document-types"),
      callApi<{ fields: FieldRow[] }>("/api/admin/field-definitions"),
    ]);
    if (t.ok) setTypes(t.data.documentTypes);
    else setError(t.message);
    if (f.ok) setFields(f.data.fields);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: Promise<{ ok: boolean; message?: string }>, done: string, after?: () => void) {
    setError(null);
    setNotice(null);
    const result = await action;
    if ("cancelled" in result && result.cancelled) return;
    if (!result.ok) return setError(result.message ?? "Something went wrong.");
    setNotice(done);
    after?.();
    await load();
  }

  const open = types.find((type) => type.id === openId) ?? null;
  const openFields = fields.filter((field) => field.documentTypeId === openId);

  function parseOptions(text: string): string[] {
    return text.split(",").map((item) => item.trim()).filter(Boolean);
  }

  return (
    <div className="space-y-6">
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="success">{notice}</Banner> : null}

      <Card title={typeEditId ? "Edit document type" : "New document type"} subtitle="The naming pattern must contain {TYPE}, {PROJECT}, {YYYY} and {SEQ:4}, for example MR-P1-2026-0007.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Short code"><input value={typeForm.code} onChange={(e) => setTypeForm({ ...typeForm, code: e.target.value })} className={inputClass} placeholder="MR" /></Field>
          <Field label="Numbering code" hint="Used in generated numbers; defaults to the short code."><input value={typeForm.numberingCode} onChange={(e) => setTypeForm({ ...typeForm, numberingCode: e.target.value })} className={inputClass} placeholder="MR" /></Field>
          <Field label="Name"><input value={typeForm.name} onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })} className={inputClass} placeholder="Material Req" /></Field>
          <Field label="Naming pattern"><input value={typeForm.namingPattern} onChange={(e) => setTypeForm({ ...typeForm, namingPattern: e.target.value })} className={inputClass} /></Field>
          <Field label="Description"><input value={typeForm.description} onChange={(e) => setTypeForm({ ...typeForm, description: e.target.value })} className={inputClass} /></Field>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={typeForm.supportsLineItems} onChange={(e) => setTypeForm({ ...typeForm, supportsLineItems: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
            This type carries a table of items (line items)
          </label>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className={primaryButton}
            onClick={() =>
              run(
                typeEditId ? callApi("/api/admin/document-types", "PATCH", { id: typeEditId, ...typeForm }) : callApi("/api/admin/document-types", "POST", typeForm),
                typeEditId ? "Document type updated." : "Document type created.",
                () => { setTypeForm(blankType); setTypeEditId(null); },
              )
            }
          >
            {typeEditId ? "Save changes" : "Create type"}
          </button>
          {typeEditId ? <button type="button" className={secondaryButton} onClick={() => { setTypeEditId(null); setTypeForm(blankType); }}>Cancel</button> : null}
        </div>
      </Card>

      <Card title="Document types">
        {types.length === 0 ? <Empty>No document types yet.</Empty> : null}
        <div className="space-y-3">
          {types.map((type) => (
            <div key={type.id} className="rounded-xl border border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <Pill>{type.code}</Pill>
                  <span className="text-xs text-slate-500">Number: {type.numberingCode}</span>
                  <span className="font-semibold text-slate-900">{type.name}</span>
                  <span className="text-xs text-slate-500">{type.subtypes.length} sub type(s) · {type._count.fieldDefinitions} field(s) · {type._count.documents} document(s)</span>
                  <Pill tone={type.isActive ? "green" : "amber"}>{type.isActive ? "Active" : "Inactive"}</Pill>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={secondaryButton} onClick={() => setOpenId(openId === type.id ? null : type.id)}>{openId === type.id ? "Close" : "Sub types & fields"}</button>
                  <button type="button" className={secondaryButton} onClick={() => { setTypeEditId(type.id); setTypeForm({ code: type.code, numberingCode: type.numberingCode, name: type.name, description: type.description ?? "", namingPattern: type.namingPattern, supportsLineItems: type.supportsLineItems }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Edit</button>
                  <button type="button" className={secondaryButton} onClick={() => run(type.isActive
                    ? callApiWithDeactivationConfirmation("/api/admin/document-types", { id: type.id, code: type.code, name: type.name, description: type.description ?? "", isActive: false })
                    : callApi("/api/admin/document-types", "PATCH", { id: type.id, code: type.code, name: type.name, description: type.description ?? "", isActive: true }), "Document type updated.")}>{type.isActive ? "Deactivate" : "Activate"}</button>
                  <button type="button" className={dangerButton} onClick={() => window.confirm(`Delete ${type.name}?`) && run(callApi("/api/admin/document-types", "DELETE", { id: type.id }), "Document type deleted.")}>Delete</button>
                </div>
              </div>

              {open && open.id === type.id ? (
                <div className="space-y-6 border-t border-slate-200 bg-slate-50 px-4 py-4">
                  <p className="text-xs text-slate-500">Naming pattern for documents without a sub type: <code>{type.namingPattern}</code></p>

                  <div>
                    <h4 className="text-sm font-semibold text-slate-900">Sub types</h4>
                    <div className="mt-2 flex flex-wrap items-end gap-3">
                      <Field label="Code"><input value={subtypeForm.code} onChange={(e) => setSubtypeForm({ ...subtypeForm, code: e.target.value })} className={inputClass} placeholder="CASH" /></Field>
                      <Field label="Numbering code"><input value={subtypeForm.numberingCode} onChange={(e) => setSubtypeForm({ ...subtypeForm, numberingCode: e.target.value })} className={inputClass} placeholder="CH" /></Field>
                      <Field label="Name"><input value={subtypeForm.name} onChange={(e) => setSubtypeForm({ ...subtypeForm, name: e.target.value })} className={inputClass} placeholder="Cash" /></Field>
                      <button
                        type="button"
                        className={primaryButton}
                        onClick={() =>
                          run(
                            subtypeEditId ? callApi("/api/admin/document-subtypes", "PATCH", { id: subtypeEditId, ...subtypeForm }) : callApi("/api/admin/document-subtypes", "POST", { documentTypeId: type.id, ...subtypeForm }),
                            subtypeEditId ? "Sub type updated." : "Sub type added.",
                            () => { setSubtypeForm({ code: "", numberingCode: "", name: "" }); setSubtypeEditId(null); },
                          )
                        }
                      >
                        {subtypeEditId ? "Save" : "Add sub type"}
                      </button>
                      {subtypeEditId ? <button type="button" className={secondaryButton} onClick={() => { setSubtypeEditId(null); setSubtypeForm({ code: "", numberingCode: "", name: "" }); }}>Cancel</button> : null}
                    </div>
                    <div className="mt-3 space-y-2">
                      {type.subtypes.length === 0 ? <p className="text-xs text-slate-500">No sub types. Documents of this type are uploaded without one.</p> : null}
                      {type.subtypes.map((subtype) => (
                        <div key={subtype.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                          <span><Pill>{subtype.code}</Pill> <span className="ml-2 font-medium text-slate-900">{subtype.name}</span> <span className="ml-2 text-xs text-slate-500">Number: {subtype.numberingCode}</span> {subtype.isActive ? null : <Pill tone="amber">Inactive</Pill>}</span>
                          <div className="flex gap-2">
                            <button type="button" className={secondaryButton} onClick={() => { setSubtypeEditId(subtype.id); setSubtypeForm({ code: subtype.code, numberingCode: subtype.numberingCode, name: subtype.name }); }}>Edit</button>
                            <button type="button" className={secondaryButton} onClick={() => run(subtype.isActive
                              ? callApiWithDeactivationConfirmation("/api/admin/document-subtypes", { id: subtype.id, code: subtype.code, numberingCode: subtype.numberingCode, name: subtype.name, isActive: false })
                              : callApi("/api/admin/document-subtypes", "PATCH", { id: subtype.id, code: subtype.code, numberingCode: subtype.numberingCode, name: subtype.name, isActive: true }), "Sub type updated.")}>{subtype.isActive ? "Deactivate" : "Activate"}</button>
                            <button type="button" className={dangerButton} onClick={() => window.confirm(`Delete ${subtype.name}?`) && run(callApi("/api/admin/document-subtypes", "DELETE", { id: subtype.id }), "Sub type deleted.")}>Delete</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold text-slate-900">Custom fields</h4>
                    <p className="text-xs text-slate-500">A field can apply to every sub type or to one. Header fields are asked once per document, line fields once per item.</p>
                    <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-4">
                      <Field label="Label"><input value={fieldForm.label} onChange={(e) => setFieldForm({ ...fieldForm, label: e.target.value })} className={inputClass} placeholder="MR number" /></Field>
                      <Field label="Key" hint="Lowercase, e.g. mr_number. Fixed once created."><input value={fieldForm.fieldKey} disabled={Boolean(fieldEditId)} onChange={(e) => setFieldForm({ ...fieldForm, fieldKey: e.target.value })} className={inputClass} /></Field>
                      <Field label="Data type">
                        <select value={fieldForm.dataType} disabled={Boolean(fieldEditId)} onChange={(e) => setFieldForm({ ...fieldForm, dataType: e.target.value })} className={inputClass}>
                          {DATA_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </Field>
                      <Field label="Applies to">
                        <select value={fieldForm.documentSubtypeId} disabled={Boolean(fieldEditId)} onChange={(e) => setFieldForm({ ...fieldForm, documentSubtypeId: e.target.value })} className={inputClass}>
                          <option value="">Every sub type</option>
                          {type.subtypes.map((subtype) => <option key={subtype.id} value={subtype.id}>{subtype.name}</option>)}
                        </select>
                      </Field>
                      <Field label="Group">
                        <select value={fieldForm.fieldGroup} disabled={Boolean(fieldEditId)} onChange={(e) => setFieldForm({ ...fieldForm, fieldGroup: e.target.value })} className={inputClass}>
                          <option value="HEADER">Header (once per document)</option>
                          {type.supportsLineItems ? <option value="LINE_ITEM">Line item (once per item)</option> : null}
                        </select>
                      </Field>
                      <Field label="Order"><input type="number" value={fieldForm.sortOrder} onChange={(e) => setFieldForm({ ...fieldForm, sortOrder: Number(e.target.value) })} className={inputClass} /></Field>
                      {fieldForm.dataType === "SELECT" || fieldForm.dataType === "MULTI_SELECT" ? (
                        <Field label="Choices" hint="Separate with commas."><input value={fieldForm.options} onChange={(e) => setFieldForm({ ...fieldForm, options: e.target.value })} className={inputClass} /></Field>
                      ) : null}
                      <label className="inline-flex items-end gap-2 pb-2 text-sm text-slate-700">
                        <input type="checkbox" checked={fieldForm.isRequired} onChange={(e) => setFieldForm({ ...fieldForm, isRequired: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
                        Required
                      </label>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        className={primaryButton}
                        onClick={() => {
                          const payload = { ...fieldForm, options: parseOptions(fieldForm.options), documentSubtypeId: fieldForm.documentSubtypeId || null };
                          void run(
                            fieldEditId ? callApi("/api/admin/field-definitions", "PATCH", { id: fieldEditId, ...payload }) : callApi("/api/admin/field-definitions", "POST", { documentTypeId: type.id, ...payload }),
                            fieldEditId ? "Field updated." : "Field added.",
                            () => { setFieldForm(blankField); setFieldEditId(null); },
                          );
                        }}
                      >
                        {fieldEditId ? "Save field" : "Add field"}
                      </button>
                      {fieldEditId ? <button type="button" className={secondaryButton} onClick={() => { setFieldEditId(null); setFieldForm(blankField); }}>Cancel</button> : null}
                    </div>
                    <div className="mt-3 space-y-2">
                      {openFields.length === 0 ? <p className="text-xs text-slate-500">No custom fields yet.</p> : null}
                      {openFields.map((field) => (
                        <div key={field.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-slate-900">{field.label}</span>
                            <Pill>{field.fieldKey}</Pill>
                            <Pill>{field.dataType.replaceAll("_", " ").toLowerCase()}</Pill>
                            <Pill>{field.fieldGroup === "HEADER" ? "header" : "line item"}</Pill>
                            {field.documentSubtypeId ? <Pill>{type.subtypes.find((s) => s.id === field.documentSubtypeId)?.name ?? "sub type"}</Pill> : null}
                            {field.isRequired ? <Pill tone="amber">required</Pill> : null}
                            {field.isActive ? null : <Pill tone="amber">inactive</Pill>}
                          </div>
                          <div className="flex gap-2">
                            <button type="button" className={secondaryButton} onClick={() => { setFieldEditId(field.id); setFieldForm({ documentSubtypeId: field.documentSubtypeId ?? "", fieldGroup: field.fieldGroup, fieldKey: field.fieldKey, label: field.label, dataType: field.dataType, isRequired: field.isRequired, options: optionsText(field.options), sortOrder: field.sortOrder }); }}>Edit</button>
                            <button type="button" className={secondaryButton} onClick={() => run(field.isActive
                              ? callApiWithDeactivationConfirmation("/api/admin/field-definitions", { id: field.id, isActive: false })
                              : callApi("/api/admin/field-definitions", "PATCH", { id: field.id, isActive: true }), "Field updated.")}>{field.isActive ? "Deactivate" : "Activate"}</button>
                            <button type="button" className={dangerButton} onClick={() => window.confirm(`Delete ${field.label}?`) && run(callApi("/api/admin/field-definitions", "DELETE", { id: field.id }), "Field deleted.")}>Delete</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
