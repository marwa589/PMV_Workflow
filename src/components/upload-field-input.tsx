"use client";

// One input for one custom field, chosen by the field's data type.
// Shared by the new-document form and the scan review page, so both look and behave the same.

export type FieldValue = string | boolean | string[];
export type FieldValues = Record<string, FieldValue>;

export type FieldInputField = {
  fieldGroup: "HEADER" | "LINE_ITEM";
  fieldKey: string;
  dataType: "TEXT" | "LONG_TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT" | "MULTI_SELECT";
  options: string[];
};

export const inputClass = "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-cyan-300 transition focus:ring-2";

export function FieldInput({ field, value, onChange, compact = false, idPrefix = "field" }: { field: FieldInputField; value: FieldValue | undefined; onChange: (next: FieldValue) => void; compact?: boolean; idPrefix?: string }) {
  const id = `${idPrefix}-${field.fieldGroup}-${field.fieldKey}`;
  switch (field.dataType) {
    case "LONG_TEXT":
      return <textarea id={id} rows={3} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className={inputClass} />;
    case "NUMBER":
      return <input id={id} type="number" step="any" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className={inputClass} />;
    case "DATE":
      return <input id={id} type="date" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className={inputClass} />;
    case "BOOLEAN":
      return (
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          {compact ? null : "Yes"}
        </label>
      );
    case "SELECT":
      return (
        <select id={id} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className={inputClass}>
          <option value="">Select...</option>
          {field.options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      );
    case "MULTI_SELECT": {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-wrap gap-3">
          {field.options.map((option) => (
            <label key={option} className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={(e) => onChange(e.target.checked ? [...selected, option] : selected.filter((item) => item !== option))}
                className="h-4 w-4 rounded border-slate-300"
              />
              {option}
            </label>
          ))}
        </div>
      );
    }
    default:
      return <input id={id} type="text" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className={inputClass} />;
  }
}
