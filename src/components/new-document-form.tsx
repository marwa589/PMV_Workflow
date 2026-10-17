"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
  Plus,
  Trash2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

type FileKind = "pdf" | "docx" | "xlsx" | "image" | "unknown";

export type UploadField = {
  id: string;
  fieldGroup: "HEADER" | "LINE_ITEM";
  fieldKey: string;
  label: string;
  dataType: "TEXT" | "LONG_TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT" | "MULTI_SELECT";
  isRequired: boolean;
  options: string[];
  documentSubtypeId: string | null;
};

// Everything the form offers comes from the database: types, sub types, projects and custom fields.
export type UploadDocumentType = {
  id: string;
  code: string;
  name: string;
  supportsLineItems: boolean;
  subtypes: Array<{ id: string; code: string; name: string }>;
  fields: UploadField[];
};

// Set when the upload is for a step of a process run: the type (and sub type, project) are then fixed.
export type UploadProcessContext = {
  instanceId: string;
  label: string;
  stepName: string;
  documentTypeId: string;
  documentSubtypeId: string | null;
  projectId: string | null;
};

type FieldValue = string | boolean | string[];
type FieldValues = Record<string, FieldValue>;

const ACCEPTED_EXTENSIONS = ["pdf", "doc", "docx", "xls", "xlsx", "jpg", "jpeg", "png"];
const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`;
}

function extensionOf(fileName: string): string {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

function fileKind(file: File): FileKind {
  const ext = extensionOf(file.name);
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "xlsx") return "xlsx";
  if (ext === "jpg" || ext === "jpeg" || ext === "png") return "image";
  return "unknown";
}

function isAcceptedFile(file: File): boolean {
  const ext = extensionOf(file.name);
  return ACCEPTED_EXTENSIONS.includes(ext) || ACCEPTED_MIME_TYPES.includes(file.type);
}

function FileTypeIcon({ file }: { file: File | null }) {
  if (!file) {
    return <UploadCloud className="h-8 w-8 text-slate-500" />;
  }

  switch (fileKind(file)) {
    case "pdf":
      return <FileText className="h-8 w-8 text-rose-600" />;
    case "docx":
      return <File className="h-8 w-8 text-blue-600" />;
    case "xlsx":
      return <FileSpreadsheet className="h-8 w-8 text-emerald-600" />;
    case "image":
      return <FileImage className="h-8 w-8 text-amber-600" />;
    default:
      return <File className="h-8 w-8 text-slate-600" />;
  }
}


function isBlank(value: FieldValue | undefined): boolean {
  return value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

// Only filled-in values are sent. Booleans are always sent (an unticked box is "no").
function cleanValues(fields: UploadField[], values: FieldValues): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const field of fields) {
    const value = values[field.fieldKey];
    if (field.dataType === "BOOLEAN") {
      if (value === true || value === false) out[field.fieldKey] = value;
      continue;
    }
    if (!isBlank(value)) out[field.fieldKey] = value as FieldValue;
  }
  return out;
}

const inputClass = "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-cyan-300 transition focus:ring-2";

function FieldInput({ field, value, onChange, compact = false }: { field: UploadField; value: FieldValue | undefined; onChange: (next: FieldValue) => void; compact?: boolean }) {
  const id = `field-${field.fieldGroup}-${field.fieldKey}`;
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

type Props = {
  documentTypes: UploadDocumentType[];
  projects: Array<{ id: string; code: string; name: string }>;
  defaultRedirectPath?: string;
  process?: UploadProcessContext | null;
};

export default function NewDocumentForm({ documentTypes, projects, defaultRedirectPath = "/clerk", process = null }: Props) {
  const router = useRouter();

  const [description, setDescription] = useState("");
  const [documentTypeId, setDocumentTypeId] = useState(process?.documentTypeId ?? "");
  const [documentSubtypeId, setDocumentSubtypeId] = useState(process?.documentSubtypeId ?? "");
  const [projectId, setProjectId] = useState(process?.projectId ?? "");
  const [headerValues, setHeaderValues] = useState<FieldValues>({});
  const [lineItems, setLineItems] = useState<FieldValues[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileTitles, setFileTitles] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);

  const selectedType = documentTypes.find((type) => type.id === documentTypeId) ?? null;
  const applicableFields = useMemo(
    () => (selectedType ? selectedType.fields.filter((field) => !field.documentSubtypeId || field.documentSubtypeId === documentSubtypeId) : []),
    [selectedType, documentSubtypeId],
  );
  const headerFields = applicableFields.filter((field) => field.fieldGroup === "HEADER");
  const lineFields = applicableFields.filter((field) => field.fieldGroup === "LINE_ITEM");
  const showLineItems = Boolean(selectedType?.supportsLineItems) && lineFields.length > 0;
  const typeLocked = Boolean(process);
  const subtypeLocked = Boolean(process?.documentSubtypeId);
  const projectLocked = Boolean(process?.projectId);

  const fileSummary = useMemo(() => {
    if (selectedFiles.length === 0) return null;
    return selectedFiles.map((file) => ({ name: file.name, size: formatBytes(file.size), type: file.type || "Unknown MIME type" }));
  }, [selectedFiles]);

  function handleFileSelection(files: FileList | File[] | null) {
    const incomingFiles = Array.from(files ?? []);
    if (incomingFiles.length === 0) return;

    const invalid = incomingFiles.find((file) => !isAcceptedFile(file));
    if (invalid) {
      setError("Unsupported file type. Allowed: PDF, Word, Excel, JPG, JPEG, PNG.");
      return;
    }

    setError(null);
    const uniqueIncomingFiles = incomingFiles.filter((file) => !selectedFiles.some((existing) => existing.name === file.name && existing.size === file.size));
    setSelectedFiles((current) => (process ? uniqueIncomingFiles.slice(0, 1) : [...current, ...uniqueIncomingFiles]));
    setFileTitles((current) => (process ? uniqueIncomingFiles.slice(0, 1).map((file) => file.name.replace(/\.[^.]+$/, "")) : [...current, ...uniqueIncomingFiles.map((file) => file.name.replace(/\.[^.]+$/, ""))]));
  }

  function onDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelection(e.dataTransfer.files);
  }

  function onDragOver(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function onDragLeave(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setIsDragging(false);
  }

  function resetForm() {
    setDescription("");
    if (!typeLocked) setDocumentTypeId("");
    if (!subtypeLocked) setDocumentSubtypeId("");
    if (!projectLocked) setProjectId("");
    setHeaderValues({});
    setLineItems([]);
    setSelectedFiles([]);
    setFileTitles([]);
    setError(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!selectedType) {
      setError("Please select a document type.");
      return;
    }
    if (selectedType.subtypes.length > 0 && !documentSubtypeId) {
      setError("Please select a sub type.");
      return;
    }
    if (selectedFiles.length === 0) {
      setError("Please choose at least one file.");
      return;
    }
    const missing = headerFields.find((field) => field.isRequired && field.dataType !== "BOOLEAN" && isBlank(headerValues[field.fieldKey]));
    if (missing) {
      setError(`${missing.label} is required.`);
      return;
    }

    const cleanLines = lineItems
      .map((line) => cleanValues(lineFields, line))
      .filter((line) => Object.keys(line).length > 0);
    for (const [index, line] of cleanLines.entries()) {
      const lineMissing = lineFields.find((field) => field.isRequired && field.dataType !== "BOOLEAN" && isBlank(line[field.fieldKey]));
      if (lineMissing) {
        setError(`Line ${index + 1}: ${lineMissing.label} is required.`);
        return;
      }
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.set("description", description);
      formData.set("documentTypeId", selectedType.id);
      if (documentSubtypeId) formData.set("documentSubtypeId", documentSubtypeId);
      if (projectId) formData.set("projectId", projectId);
      if (process) formData.set("processInstanceId", process.instanceId);
      formData.set("submissionKey", crypto.randomUUID());
      formData.set("fieldValues", JSON.stringify(cleanValues(headerFields, headerValues)));
      if (showLineItems) formData.set("lineItems", JSON.stringify(cleanLines));
      selectedFiles.forEach((file, index) => {
        formData.append("files", file);
        formData.append("fileTitles", fileTitles[index] || file.name.replace(/\.[^.]+$/, ""));
      });

      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "x-csrf-token": getCsrfTokenFromBrowser() },
        body: formData,
      });

      const result = (await response.json()) as { message?: string };
      if (!response.ok) {
        setError(result.message || "Failed to create document.");
        setIsSubmitting(false);
        return;
      }

      setIsSubmitting(false);
      setShowToast(true);
      resetForm();
      window.setTimeout(() => {
        setShowToast(false);
        router.push(process ? `/processes/${process.instanceId}` : defaultRedirectPath);
        router.refresh();
      }, 1600);
    } catch {
      setIsSubmitting(false);
      setError("Unexpected error while submitting document.");
    }
  }

  return (
    <>
      {showToast && (
        <div className="fixed right-4 top-4 z-50 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900 shadow-lg">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="h-4 w-4" />
            Document created successfully
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        {process ? (
          <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
            Adding the document for step <span className="font-semibold">{process.stepName}</span> of <span className="font-semibold">{process.label}</span>.
          </div>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-base font-semibold text-slate-900">Document Details</h2>

          <div className="mt-4 grid grid-cols-1 gap-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Document Type <span className="text-rose-600">*</span>
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {documentTypes.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    disabled={typeLocked}
                    onClick={() => {
                      setDocumentTypeId(type.id);
                      setDocumentSubtypeId("");
                      setHeaderValues({});
                      setLineItems([]);
                    }}
                    className={`rounded-xl border px-4 py-3 text-left text-sm font-medium transition ${
                      documentTypeId === type.id
                        ? "border-2 border-cyan-500 bg-cyan-50 text-cyan-700"
                        : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
                    } disabled:cursor-not-allowed disabled:opacity-70`}
                  >
                    {type.name}
                  </button>
                ))}
                {documentTypes.length === 0 ? <p className="text-sm text-slate-500">No document types are set up yet.</p> : null}
              </div>
            </div>

            {selectedType && selectedType.subtypes.length > 0 ? (
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Sub Type <span className="text-rose-600">*</span>
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {selectedType.subtypes.map((subtype) => (
                    <button
                      key={subtype.id}
                      type="button"
                      disabled={subtypeLocked}
                      onClick={() => {
                        setDocumentSubtypeId(subtype.id);
                        setHeaderValues({});
                      }}
                      className={`rounded-xl border px-4 py-3 text-left text-sm font-medium transition ${
                        documentSubtypeId === subtype.id
                          ? "border-2 border-cyan-500 bg-cyan-50 text-cyan-700"
                          : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
                      } disabled:cursor-not-allowed disabled:opacity-70`}
                    >
                      {subtype.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div>
              <label htmlFor="project" className="mb-2 block text-sm font-medium text-slate-700">
                Project
              </label>
              <select id="project" value={projectId} disabled={projectLocked} onChange={(e) => setProjectId(e.target.value)} className={inputClass}>
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.code} - {project.name}</option>
                ))}
              </select>
            </div>

            {headerFields.length > 0 ? (
              <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                {headerFields.map((field) => (
                  <div key={field.id}>
                    <label htmlFor={`field-HEADER-${field.fieldKey}`} className="mb-2 block text-sm font-medium text-slate-700">
                      {field.label} {field.isRequired ? <span className="text-rose-600">*</span> : <span className="font-normal text-slate-500">(optional)</span>}
                    </label>
                    <FieldInput field={field} value={headerValues[field.fieldKey]} onChange={(next) => setHeaderValues((current) => ({ ...current, [field.fieldKey]: next }))} />
                  </div>
                ))}
              </div>
            ) : null}

            {showLineItems ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-700">Items</p>
                  <button type="button" onClick={() => setLineItems((current) => [...current, {}])} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                    <Plus className="h-3.5 w-3.5" />
                    Add line
                  </button>
                </div>
                {lineItems.length === 0 ? <p className="text-xs text-slate-500">No lines added.</p> : null}
                <div className="space-y-3">
                  {lineItems.map((line, index) => (
                    <div key={index} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                        <span>Line {index + 1}</span>
                        <button type="button" onClick={() => setLineItems((current) => current.filter((_, i) => i !== index))} className="inline-flex items-center gap-1 text-slate-600 hover:text-rose-600">
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {lineFields.map((field) => (
                          <div key={field.id}>
                            <label className="mb-1 block text-xs font-medium text-slate-600">
                              {field.label} {field.isRequired ? <span className="text-rose-600">*</span> : null}
                            </label>
                            <FieldInput field={field} compact value={line[field.fieldKey]} onChange={(next) => setLineItems((current) => current.map((item, i) => (i === index ? { ...item, [field.fieldKey]: next } : item)))} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div>
              <label htmlFor="description" className="mb-2 block text-sm font-medium text-slate-700">
                Description
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Add optional context for approvers"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none ring-cyan-300 transition focus:ring-2"
              />
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-base font-semibold text-slate-900">Upload File</h2>
          <p className="mt-1 text-xs text-slate-500">Accepted: PDF, Word, Excel, JPG, JPEG, PNG. You can upload multiple files.</p>

          <label
            htmlFor="file-input"
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            className={`mt-4 block cursor-pointer rounded-2xl border-2 border-dashed p-6 transition sm:p-8 ${
              isDragging ? "border-cyan-500 bg-cyan-50" : "border-slate-300 bg-slate-50 hover:border-slate-400"
            }`}
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <FileTypeIcon file={selectedFiles[0] ?? null} />
              <div>
                <p className="text-sm font-medium text-slate-800">Drag and drop files here, or click to browse</p>
                <p className="mt-1 text-xs text-slate-500">
                  {process
                    ? "Upload the document for this process step."
                    : "Upload one or more files. Each file will become its own document."}
                </p>
              </div>
            </div>

            <input
              id="file-input"
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
              className="sr-only"
              multiple={!process}
              onChange={(e) => handleFileSelection(e.target.files)}
            />
          </label>

          {fileSummary && (
            <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              {fileSummary.map((file, index) => (
                <div key={`${file.name}-${index}`} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 p-3">
                  <div className="flex items-start gap-3">
                    <FileTypeIcon file={selectedFiles[index] ?? null} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900">{file.name}</p>
                      <p className="text-xs text-slate-500">{file.size}</p>
                      <p className="text-xs text-slate-500">{file.type}</p>
                      <label className="mt-2 block text-xs font-medium text-slate-600">
                        Title
                        <input
                          type="text"
                          value={fileTitles[index] || ""}
                          onChange={(e) => {
                            const nextTitles = [...fileTitles];
                            nextTitles[index] = e.target.value;
                            setFileTitles(nextTitles);
                          }}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none ring-cyan-300 transition focus:ring-2"
                          placeholder="Enter document title"
                        />
                      </label>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
                      setFileTitles((current) => current.filter((_, itemIndex) => itemIndex !== index));
                    }}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                  >
                    <XCircle className="h-4 w-4" />
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {error}
            </div>
          )}
        </section>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => router.push(defaultRedirectPath)}
            disabled={isSubmitting}
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              "Create Document"
            )}
          </button>
        </div>
      </form>
    </>
  );
}
