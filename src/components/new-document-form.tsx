"use client";

import { useEffect, useMemo, useState } from "react";
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
import { FieldInput, inputClass, type FieldValue, type FieldValues } from "@/components/upload-field-input";
import DocumentScanPanel from "@/components/document-scan-panel";
import LinkedDocumentPicker from "@/components/linked-document-picker";
import ProjectPicker from "@/components/project-picker";
import { findAutoMatch, stripExtension } from "@/lib/linked-document-match";
import type { AwaitingUpload } from "@/lib/workflow/processes";
import DocumentScanReview from "@/components/document-scan-review";
import { fileKey, useDocumentScan } from "@/lib/document-scan/use-document-scan";
import { DOCUMENT_SCAN_ENABLED } from "@/lib/document-scan/config";

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

// Set when the upload is the next document of a running process: the uploader picks one of the open choices
// (the child nodes of the last approved document), and the type (and sub type, project) are then fixed by that choice.
export type UploadProcessOption = {
  stepId: string;
  name: string;
  documentTypeId: string;
  documentSubtypeId: string | null;
  typeName: string;
  subtypeName: string | null;
  // Optional reference document this step lets the uploader attach.
  referenceDocumentTypeId: string | null;
  referenceDocumentSubtypeId: string | null;
  // Set up on the process step: several documents may be uploaded together, each starting its own linked run.
  allowMultipleUploads?: boolean;
  waitingUntil?: Date | string | null;
};

// A document type that may be attached as a reference document (type, sub types, and whether a new file needs approval).
export type ReferenceTypeInfo = { id: string; name: string; subtypes: Array<{ id: string; name: string }>; requiresApproval: boolean };
export type RootReferenceInfo = {
  documentTypeId: string;
  documentSubtypeId: string | null;
  referenceDocumentTypeId: string;
  referenceDocumentSubtypeId: string | null;
};

// Set when an Admin user starts a process on purpose: the first (root) document of that process is uploaded.
export type UploadStartProcess = {
  definitionId: string;
  name: string;
  rootName: string;
  documentTypeId: string;
  documentSubtypeId: string | null;
  typeName: string;
  subtypeName: string | null;
};

// My Tasks "Upload several": files of ONE sub type, each linked to one of the person's awaiting tasks (matched by name).
export type UploadBulkContext = {
  documentTypeId: string;
  documentSubtypeId: string | null;
  label: string;
  // For each awaiting task (`${runId}|${stepId}`), the other documents the same run could continue with instead.
  siblings: Record<string, string[]>;
};

export type UploadProcessContext = {
  instanceId: string;
  label: string;
  projectId: string | null;
  options: UploadProcessOption[];
};

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

type Props = {
  documentTypes: UploadDocumentType[];
  // director / manager: the project's people (shown next to the project so uploaders can check the path).
  projects: Array<{ id: string; code: string; name: string; director?: { name: string; isActive: boolean } | null; manager?: { name: string; isActive: boolean } | null }>;
  defaultRedirectPath?: string;
  process?: UploadProcessContext | null;
  // Admin only: preselect one of the open choices of the run (comes from the "Upload" button of a step).
  initialStepId?: string;
  // Admin only: starting a process on purpose.
  startProcess?: UploadStartProcess | null;
  // Admin only: shows the "already approved" option.
  isAdmin?: boolean;
  rootReferences?: RootReferenceInfo[];
  referenceTypes?: ReferenceTypeInfo[];
  // Types / sub types that only exist as a LATER document of a process tree: every file of these must name the document it follows.
  linkedTypeScopes?: Array<{ documentTypeId: string; documentSubtypeId: string | null }>;
  // The documents a later document can follow (waiting runs, and completed runs the document is added to).
  linkedEntries?: AwaitingUpload[];
  // What this person may upload, as `${projectId}|${typeId}|${subtypeId}` keys ("" = no project / no sub type).
  // null = no limit (Admin users, and running processes which offer only their own choices).
  uploadScopeKeys?: string[] | null;
  // Set when several awaiting tasks of one sub type are uploaded together (from My Tasks).
  bulk?: UploadBulkContext | null;
};

type ReferenceState = {
  mode: "none" | "upload" | "existing";
  file: File | null;
  title: string;
  subtypeId: string;
  documentId: string;
};

const blankReference = (): ReferenceState => ({ mode: "none", file: null, title: "", subtypeId: "", documentId: "" });

/** Bulk upload from My Tasks: the awaiting documents of this sub type, ticked off as files are matched to them. */
function BulkTasksSummary({ bulk, entries, matchedKeys }: { bulk: UploadBulkContext; entries: AwaitingUpload[]; matchedKeys: Set<string> }) {
  const [open, setOpen] = useState(true);
  const matched = entries.filter((entry) => matchedKeys.has(entry.key)).length;
  return (
    <section className="rounded-2xl border border-cyan-200 bg-cyan-50 shadow-sm">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left sm:px-6">
        <span>
          <span className="block text-base font-semibold text-cyan-900">Awaiting {bulk.label}</span>
          <span className="mt-0.5 block text-sm text-cyan-900/80">
            {matched} of {entries.length} awaiting document{entries.length === 1 ? "" : "s"} {matched === 1 ? "has" : "have"} a file. Documents without a file stay in My Tasks.
          </span>
        </span>
        <span className="flex items-center gap-3">
          <span className="h-2 w-32 overflow-hidden rounded-full bg-white ring-1 ring-cyan-200">
            <span className="block h-full rounded-full bg-cyan-600 transition-all" style={{ width: `${entries.length ? Math.round((matched / entries.length) * 100) : 0}%` }} />
          </span>
          <span className="text-xs font-medium text-cyan-900">{open ? "Hide" : "Show"}</span>
        </span>
      </button>
      {open ? (
        <ul className="max-h-64 divide-y divide-cyan-100 overflow-y-auto border-t border-cyan-100 px-5 sm:px-6">
          {entries.map((entry) => {
            const done = matchedKeys.has(entry.key);
            const others = bulk.siblings[entry.key] ?? [];
            return (
              <li key={entry.key} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                <span className="flex min-w-0 items-start gap-2">
                  {done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <span className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-cyan-300" />}
                  <span className="min-w-0">
                    <span className="font-medium text-slate-900">{entry.previousDocument?.documentNumber ?? entry.label}</span>
                    {entry.previousDocument?.title ? <span className="text-slate-600"> · {entry.previousDocument.title}</span> : null}
                    <span className="block text-xs text-slate-500">
                      {entry.option.name}
                      {entry.projectLabel ? ` · ${entry.projectLabel}` : ""}
                      {others.length > 0 ? ` · could also continue with ${others.join(", ")}` : ""}
                    </span>
                  </span>
                </span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${done ? "bg-emerald-100 text-emerald-800" : "bg-white text-slate-600 ring-1 ring-cyan-200"}`}>{done ? "File matched" : "No file yet"}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * The optional reference document of ONE uploaded file: none, a new file, or an approved document picked from the list.
 * It is not approved and only people with "View reference documents" can see it.
 */
function ReferencePicker({
  index,
  value,
  onChange,
  onRemove,
  type,
  config,
  projectId,
  needsSubtype,
  onError,
}: {
  // Unique per file and per reference (radio groups must not clash).
  index: string;
  value: ReferenceState;
  onChange: (next: ReferenceState) => void;
  // Set for the extra references (the first one is simply left on "None").
  onRemove?: () => void;
  type: ReferenceTypeInfo;
  config: { typeId: string; subtypeId: string | null };
  projectId: string;
  needsSubtype: boolean;
  onError: (message: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<Array<{ id: string; documentNumber: string; title: string; projectCode: string | null }>>([]);
  const inputClass = "w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none ring-cyan-300 transition focus:ring-2";

  // Approved documents that could be picked as the reference (typed search, as you go).
  useEffect(() => {
    if (value.mode !== "existing") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams({ documentTypeId: config.typeId });
      if (config.subtypeId) params.set("documentSubtypeId", config.subtypeId);
      if (projectId) params.set("projectId", projectId);
      if (search.trim()) params.set("search", search.trim());
      try {
        const response = await fetch(`/api/documents/reference-candidates?${params.toString()}`, { signal: controller.signal });
        if (!response.ok) return;
        const data = (await response.json()) as { documents: Array<{ id: string; documentNumber: string; title: string; projectCode: string | null }> };
        setCandidates(data.documents);
      } catch {
        // Ignored: a newer search replaced this one.
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [value.mode, config.typeId, config.subtypeId, projectId, search]);

  const group = `reference-mode-${index}`;
  return (
    <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-700">Reference document (optional) · {type.name}</p>
        {onRemove ? (
          <button type="button" onClick={onRemove} className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900">
            <XCircle className="h-3.5 w-3.5" />
            Remove
          </button>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-sm text-slate-700">
        <label className="flex items-center gap-2">
          <input type="radio" name={group} checked={value.mode === "none"} onChange={() => onChange({ ...value, mode: "none" })} />
          None
        </label>
        {!type.requiresApproval ? (
          <label className="flex items-center gap-2">
            <input type="radio" name={group} checked={value.mode === "upload"} onChange={() => onChange({ ...value, mode: "upload" })} />
            Upload a new file
          </label>
        ) : null}
        <label className="flex items-center gap-2">
          <input type="radio" name={group} checked={value.mode === "existing"} onChange={() => onChange({ ...value, mode: "existing" })} />
          Pick an approved document
        </label>
      </div>
      {type.requiresApproval ? <p className="mt-2 text-xs text-amber-700">{type.name} goes through approval, so only an already approved document can be used as the reference.</p> : null}

      {value.mode === "upload" ? (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Reference file</label>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                if (file && !isAcceptedFile(file)) {
                  onError("Unsupported file type. Allowed: PDF, Word, Excel, JPG, JPEG, PNG.");
                  return;
                }
                onError(null);
                onChange({ ...value, file, title: file ? file.name.replace(/\.[^.]+$/, "") : value.title });
              }}
              className="block w-full text-sm text-slate-700"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Title</label>
            <input type="text" value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} className={inputClass} />
          </div>
          {needsSubtype ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Reference sub type</label>
              <select value={value.subtypeId} onChange={(e) => onChange({ ...value, subtypeId: e.target.value })} className={inputClass}>
                <option value="">Select a sub type</option>
                {type.subtypes.map((subtype) => <option key={subtype.id} value={subtype.id}>{subtype.name}</option>)}
              </select>
            </div>
          ) : null}
        </div>
      ) : null}

      {value.mode === "existing" ? (
        <div className="mt-3 space-y-2">
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by number or title" className={inputClass} />
          {candidates.length === 0 ? (
            <p className="text-xs text-slate-500">No approved documents of this type found.</p>
          ) : (
            <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 bg-white">
              {candidates.map((candidate) => (
                <li key={candidate.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                    <input type="radio" name={`reference-existing-${index}`} checked={value.documentId === candidate.id} onChange={() => onChange({ ...value, documentId: candidate.id })} />
                    <span className="font-medium text-slate-900">{candidate.documentNumber}</span>
                    <span className="text-slate-600">{candidate.title}</span>
                    {candidate.projectCode ? <span className="text-xs text-slate-500">{candidate.projectCode}</span> : null}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function NewDocumentForm({ documentTypes, projects, defaultRedirectPath = "/clerk", process = null, initialStepId = "", startProcess = null, isAdmin = false, rootReferences = [], referenceTypes = [], linkedTypeScopes = [], linkedEntries = [], uploadScopeKeys = null, bulk = null }: Props) {
  const router = useRouter();

  const [description, setDescription] = useState("");
  const onlyOption = process && process.options.length === 1 ? process.options[0] : null;
  // One open choice is chosen for the person; an Admin user can also arrive with the step already picked.
  const startOption = onlyOption ?? process?.options.find((option) => option.stepId === initialStepId) ?? null;
  const [processStepId, setProcessStepId] = useState(startOption?.stepId ?? "");
  const [documentTypeId, setDocumentTypeId] = useState(startOption?.documentTypeId ?? startProcess?.documentTypeId ?? bulk?.documentTypeId ?? "");
  const [documentSubtypeId, setDocumentSubtypeId] = useState(startOption?.documentSubtypeId ?? startProcess?.documentSubtypeId ?? bulk?.documentSubtypeId ?? "");
  // Bulk upload: files whose run could also continue with another document need the uploader to confirm the choice.
  const [confirmedBranches, setConfirmedBranches] = useState<Record<string, boolean>>({});
  // Admin only: the document is already approved (no approval flow), optionally with the date it was approved on.
  const [alreadyApproved, setAlreadyApproved] = useState(false);
  const [approvedDate, setApprovedDate] = useState("");
  const [notifyNext, setNotifyNext] = useState(false);
  // Unique tracks of the flow's uploader level; the check box is always off until the uploader ticks it.
  const [uniqueTracks, setUniqueTracks] = useState<Array<{ sortOrder: number; name: string; receiverName: string | null }>>([]);
  const [trackSortOrder, setTrackSortOrder] = useState<number | null>(null);
  const [projectId, setProjectId] = useState(process?.projectId ?? "");
  const [projectTouched, setProjectTouched] = useState(false);
  const [headerValues, setHeaderValues] = useState<FieldValues>({});
  const [lineItems, setLineItems] = useState<FieldValues[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileTitles, setFileTitles] = useState<string[]>([]);
  // Each file's own description (same position as the file). `null` = not edited yet: it follows the Description above.
  const [fileDescriptions, setFileDescriptions] = useState<Array<string | null>>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);
  // Optional reference document for EACH uploaded file (same position as the file).
  // Each file can carry any number of reference documents (same position as the file).
  const [references, setReferences] = useState<ReferenceState[][]>([]);
  // The linked document of each file (by file), chosen by the uploader or matched from the file name.
  const [linkChoices, setLinkChoices] = useState<Record<string, { key: string; auto: boolean }>>({});

  const selectedType = documentTypes.find((type) => type.id === documentTypeId) ?? null;
  const applicableFields = useMemo(
    () => (selectedType ? selectedType.fields.filter((field) => !field.documentSubtypeId || field.documentSubtypeId === documentSubtypeId) : []),
    [selectedType, documentSubtypeId],
  );
  const headerFields = applicableFields.filter((field) => field.fieldGroup === "HEADER");
  const lineFields = applicableFields.filter((field) => field.fieldGroup === "LINE_ITEM");
  const showLineItems = Boolean(selectedType?.supportsLineItems) && lineFields.length > 0;
  const chosenOption = process?.options.find((option) => option.stepId === processStepId) ?? null;
  const typeLocked = Boolean(process) || Boolean(startProcess) || Boolean(bulk);
  const subtypeLocked = Boolean(chosenOption?.documentSubtypeId) || Boolean(startProcess?.documentSubtypeId) || Boolean(bulk);
  // "Allow multiple uploads" comes from the process setup of the chosen step: each file then becomes its own
  // follow-up run, linked to the run and the approved document it follows.
  const allowMultiple = Boolean(chosenOption?.allowMultipleUploads);
  const singleFile = (Boolean(process) && !allowMultiple) || Boolean(startProcess);
  // A later document of a process (not a start document) must name the document it follows; roots and documents
  // outside every process need no link.
  const linkRequired =
    Boolean(bulk) ||
    (!process &&
    !startProcess &&
    Boolean(selectedType) &&
    linkedTypeScopes.some((scope) => scope.documentTypeId === documentTypeId && scope.documentSubtypeId === (documentSubtypeId || null)));
  const typeEntries = useMemo(
    () =>
      linkRequired
        ? linkedEntries.filter(
            (entry) => entry.option.documentTypeId === documentTypeId && (!entry.option.documentSubtypeId || entry.option.documentSubtypeId === documentSubtypeId),
          )
        : [],
    [linkRequired, linkedEntries, documentTypeId, documentSubtypeId],
  );
  const chosenEntries = useMemo(
    () => selectedFiles.flatMap((file) => typeEntries.filter((entry) => entry.key === linkChoices[fileKey(file)]?.key)),
    [selectedFiles, linkChoices, typeEntries],
  );
  // Each file gets the project of the document it follows, so the project field cannot be changed. With one project
  // for every file it shows that project; with several it says each file takes its own.
  const entryForFile = (index: number) => {
    const file = selectedFiles[index];
    return file ? typeEntries.find((entry) => entry.key === linkChoices[fileKey(file)]?.key) ?? null : null;
  };
  const linkedProjects = new Set(chosenEntries.map((entry) => entry.projectId ?? ""));
  const linkedProjectId = chosenEntries.length > 0 && linkedProjects.size === 1 ? chosenEntries[0].projectId ?? "" : null;
  const linkedMode = linkRequired && chosenEntries.length > 0;
  const projectLocked = Boolean(process) || linkedMode;

  // Name matching: a file called "LPO-783050-MR-214497.pdf" is linked to "MR 214497" by itself (when only one fits).
  useEffect(() => {
    if (!linkRequired) return;
    setLinkChoices((current) => {
      let changed = false;
      const next = { ...current };
      selectedFiles.forEach((file, index) => {
        const key = fileKey(file);
        const existing = next[key];
        if (existing && typeEntries.some((entry) => entry.key === existing.key)) return;
        if (existing) {
          delete next[key];
          changed = true;
        }
        const match = findAutoMatch([stripExtension(file.name), fileTitles[index] ?? ""], typeEntries);
        if (match) {
          next[key] = { key: match.key, auto: true };
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [linkRequired, selectedFiles, fileTitles, typeEntries]);

  useEffect(() => {
    if (linkedMode) setProjectId(linkedProjectId ?? "");
  }, [linkedMode, linkedProjectId]);
  // Inside a process only the chosen document's type is offered; elsewhere every type is.
  // What the person may upload decides what is offered, and the three choices narrow each other: a type is offered for the
  // chosen project, a sub type for the chosen project and type, and a project for the chosen type / sub type.
  const keySet = useMemo(() => (uploadScopeKeys ? new Set(uploadScopeKeys) : null), [uploadScopeKeys]);
  const projectScopeKnown = Boolean(keySet) && !process && !startProcess;
  const allowedFor = (projectKey: string, typeId: string, subtypeId: string) => !keySet || keySet.has(`${projectKey}|${typeId}|${subtypeId}`);
  const typeAllowedFor = (type: UploadDocumentType, projectKey: string) =>
    type.subtypes.length > 0 ? type.subtypes.some((subtype) => allowedFor(projectKey, type.id, subtype.id)) : allowedFor(projectKey, type.id, "");
  // In linked mode the project comes from the linked document; the type list then does not depend on a project choice.
  // Until the person touches the project field, "No project" is only the starting value, not a choice that narrows the types.
  const projectFilterKey = linkedMode ? null : projectId !== "" || projectTouched ? projectId : null;
  const typesForProject = !projectScopeKnown || projectFilterKey === null ? documentTypes : documentTypes.filter((type) => typeAllowedFor(type, projectFilterKey));
  const subtypesForChoice = (type: UploadDocumentType) =>
    !projectScopeKnown || projectFilterKey === null ? type.subtypes : type.subtypes.filter((subtype) => allowedFor(projectFilterKey, type.id, subtype.id));
  const projectAllowedForChoice = (candidateProjectKey: string) => {
    if (!projectScopeKnown) return true;
    const chosenType = documentTypes.find((type) => type.id === documentTypeId);
    if (!chosenType) return documentTypes.some((type) => typeAllowedFor(type, candidateProjectKey));
    if (chosenType.subtypes.length > 0 && !documentSubtypeId) return typeAllowedFor(chosenType, candidateProjectKey);
    return allowedFor(candidateProjectKey, chosenType.id, documentSubtypeId);
  };
  const projectsForChoice = projectScopeKnown ? projects.filter((project) => projectAllowedForChoice(project.id)) : projects;
  const noProjectAllowed = !projectScopeKnown || projectAllowedForChoice("");
  const visibleTypes = process || startProcess || bulk ? documentTypes.filter((type) => type.id === documentTypeId) : typesForProject;

  // A choice that stops being allowed after another choice changed is cleared instead of being submitted.
  useEffect(() => {
    if (!projectScopeKnown) return;
    const chosenType = documentTypes.find((type) => type.id === documentTypeId);
    if (chosenType && projectFilterKey !== null && !typeAllowedFor(chosenType, projectFilterKey)) {
      setDocumentTypeId("");
      setDocumentSubtypeId("");
      return;
    }
    if (chosenType && documentSubtypeId && projectFilterKey !== null && !allowedFor(projectFilterKey, chosenType.id, documentSubtypeId)) {
      setDocumentSubtypeId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectScopeKnown, projectFilterKey, documentTypeId, documentSubtypeId]);

  // Reading the attached files to fill the fields (free OCR in the browser). It needs the type, and the sub type if there is one.
  const scanEnabled = DOCUMENT_SCAN_ENABLED && selectedType !== null && (selectedType.subtypes.length === 0 || Boolean(documentSubtypeId)) && (headerFields.length > 0 || showLineItems);
  const scan = useDocumentScan({
    files: selectedFiles,
    fields: applicableFields,
    readLineItems: showLineItems,
    enabled: scanEnabled,
    signature: `${documentTypeId}|${documentSubtypeId}`,
  });
  // Once the values of every file are confirmed, they replace the shared fields below (each file is its own document).
  const usingScan = scan.allConfirmed;

  // Which reference document (if any) this upload may carry: the chosen step's setting, or the start document's setting.
  const referenceConfig = useMemo(() => {
    if (process) {
      return chosenOption?.referenceDocumentTypeId
        ? { typeId: chosenOption.referenceDocumentTypeId, subtypeId: chosenOption.referenceDocumentSubtypeId }
        : null;
    }
    if (linkRequired) {
      const withReference = chosenEntries.find((entry) => entry.option.referenceDocumentTypeId);
      return withReference?.option.referenceDocumentTypeId
        ? { typeId: withReference.option.referenceDocumentTypeId, subtypeId: withReference.option.referenceDocumentSubtypeId }
        : null;
    }
    const matches = rootReferences.filter(
      (config) => config.documentTypeId === documentTypeId && (!config.documentSubtypeId || config.documentSubtypeId === documentSubtypeId),
    );
    const best = matches.find((config) => config.documentSubtypeId) ?? matches[0];
    return best ? { typeId: best.referenceDocumentTypeId, subtypeId: best.referenceDocumentSubtypeId } : null;
  }, [process, chosenOption, linkRequired, chosenEntries, rootReferences, documentTypeId, documentSubtypeId]);
  // Load the unique tracks of the flow that applies to the chosen type / sub type / project.
  useEffect(() => {
    setTrackSortOrder(null);
    if (!documentTypeId) {
      setUniqueTracks([]);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ documentTypeId });
    if (documentSubtypeId) params.set("documentSubtypeId", documentSubtypeId);
    if (projectId) params.set("projectId", projectId);
    fetch(`/api/documents/tracks?${params.toString()}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : { tracks: [] }))
      .then((data: { tracks: Array<{ sortOrder: number; name: string; receiverName: string | null }> }) => setUniqueTracks(data.tracks ?? []))
      .catch(() => undefined);
    return () => controller.abort();
  }, [documentTypeId, documentSubtypeId, projectId]);

  const referenceType = referenceConfig ? referenceTypes.find((type) => type.id === referenceConfig.typeId) ?? null : null;
  const referenceAvailable = Boolean(referenceConfig && referenceType);
  const needsReferenceSubtype = Boolean(referenceType && referenceType.subtypes.length > 0 && !referenceConfig?.subtypeId);

  // The step (and with it the reference setting) changed: start every file's reference choice over.
  useEffect(() => {
    setReferences((current) => current.map(() => [blankReference()]));
  }, [referenceConfig?.typeId, referenceConfig?.subtypeId]);

  function chooseProcessOption(option: UploadProcessOption) {
    setProcessStepId(option.stepId);
    // A step that does not allow multiple uploads holds one document: keep the first file only.
    if (!option.allowMultipleUploads) {
      setSelectedFiles((current) => current.slice(0, 1));
      setFileTitles((current) => current.slice(0, 1));
      setReferences((current) => current.slice(0, 1));
    }
    setDocumentTypeId(option.documentTypeId);
    setDocumentSubtypeId(option.documentSubtypeId ?? "");
    setHeaderValues({});
    setLineItems([]);
  }

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
    setSelectedFiles((current) => (singleFile ? uniqueIncomingFiles.slice(0, 1) : [...current, ...uniqueIncomingFiles]));
    setReferences((current) => (singleFile ? uniqueIncomingFiles.slice(0, 1).map(() => [blankReference()]) : [...current, ...uniqueIncomingFiles.map(() => [blankReference()])]));
    setFileTitles((current) => (singleFile ? uniqueIncomingFiles.slice(0, 1).map((file) => file.name.replace(/\.[^.]+$/, "")) : [...current, ...uniqueIncomingFiles.map((file) => file.name.replace(/\.[^.]+$/, ""))]));
    setFileDescriptions((current) => (singleFile ? uniqueIncomingFiles.slice(0, 1).map(() => null) : [...current, ...uniqueIncomingFiles.map(() => null)]));
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
    if (!process) setProjectId("");
    setLinkChoices({});
    setConfirmedBranches({});
    if (!onlyOption) setProcessStepId("");
    setHeaderValues({});
    setLineItems([]);
    setSelectedFiles([]);
    setFileTitles([]);
    setFileDescriptions([]);
    setReferences([]);
    setAlreadyApproved(false);
    setApprovedDate("");
    setNotifyNext(false);
    scan.reset();
    setError(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (process && !processStepId) {
      setError("Choose which document to upload next.");
      return;
    }
    if (!selectedType) {
      setError("Please select a document type.");
      return;
    }
    if (selectedType.subtypes.length > 0 && !documentSubtypeId) {
      setError("Please select a sub type.");
      return;
    }
    if (projectScopeKnown && !linkedMode && !allowedFor(projectId, selectedType.id, documentSubtypeId)) {
      setError(projectId === "" ? "Please select a project." : "You are not allowed to upload this type of document for the chosen project.");
      return;
    }
    if (selectedFiles.length === 0) {
      setError("Please choose at least one file.");
      return;
    }
    if (linkRequired) {
      // The linked document is optional for now: a file without one is uploaded on its own.
      const picked = selectedFiles.flatMap((file) => typeEntries.filter((entry) => entry.key === linkChoices[fileKey(file)]?.key));
      const taken = new Map<string, number>();
      for (const entry of picked) taken.set(entry.key, (taken.get(entry.key) ?? 0) + 1);
      const crowded = picked.find((entry) => entry.mode === "continue" && !entry.option.allowMultipleUploads && (taken.get(entry.key) ?? 0) > 1);
      if (crowded) {
        setError(`Only one document can be uploaded for ${crowded.previousDocument?.documentNumber ?? crowded.label} (${crowded.option.name}).`);
        return;
      }
      if (bulk) {
        // Every file must belong to one of the awaiting tasks, and a run with other choices needs the choice confirmed.
        const unlinked = selectedFiles.find((file) => !typeEntries.some((entry) => entry.key === linkChoices[fileKey(file)]?.key));
        if (unlinked) {
          setError(`Choose the awaiting document ${unlinked.name} belongs to, or remove the file.`);
          return;
        }
        const unconfirmed = selectedFiles.find((file) => {
          const key = linkChoices[fileKey(file)]?.key ?? "";
          return (bulk.siblings[key] ?? []).length > 0 && !confirmedBranches[`${fileKey(file)}|${key}`];
        });
        if (unconfirmed) {
          setError(`Confirm which document ${unconfirmed.name} continues its process with.`);
          return;
        }
      }
    }
    if (referenceAvailable) {
      for (const [index, item] of references.flatMap((list, fileIndex) => list.map((entry) => ({ ...entry, fileIndex }))).map((entry) => [entry.fileIndex, entry] as const)) {
        const where = selectedFiles.length > 1 ? ` for ${selectedFiles[index]?.name ?? `file ${index + 1}`}` : "";
        if (item.mode === "upload") {
          if (!item.file) {
            setError(`Choose the reference file${where}, or pick "None".`);
            return;
          }
          if (needsReferenceSubtype && !item.subtypeId) {
            setError(`Choose the sub type of the reference document${where}.`);
            return;
          }
        }
        if (item.mode === "existing" && !item.documentId) {
          setError(`Pick the approved document to use as the reference${where}, or choose "None".`);
          return;
        }
      }
    }
    const missing = usingScan ? undefined : headerFields.find((field) => field.isRequired && field.dataType !== "BOOLEAN" && isBlank(headerValues[field.fieldKey]));
    if (missing) {
      setError(`${missing.label} is required.`);
      return;
    }

    const cleanLines = (usingScan ? [] : lineItems)
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
      if (trackSortOrder !== null && !(isAdmin && alreadyApproved)) formData.set("trackSortOrder", String(trackSortOrder));
      if (process) {
        formData.set("processInstanceId", process.instanceId);
        formData.set("processStepId", processStepId);
      }
      if (startProcess) formData.set("startProcessDefinitionId", startProcess.definitionId);
      if (linkRequired) {
        selectedFiles.forEach((file, index) => {
          const choice = linkChoices[fileKey(file)];
          if (choice) formData.set(`linkedKey_${index}`, choice.key);
        });
      }
      if (isAdmin && alreadyApproved) {
        formData.set("alreadyApproved", "true");
        if (approvedDate) formData.set("approvedAt", approvedDate);
        if (notifyNext) formData.set("notify", "true");
      }
      if (referenceAvailable) {
        references.forEach((list, index) => {
          formData.set(`referenceCount_${index}`, String(list.length));
          list.forEach((item, position) => {
            const key = `${index}_${position}`;
            if (item.mode === "upload" && item.file) {
              formData.set(`referenceFile_${key}`, item.file);
              formData.set(`referenceTitle_${key}`, item.title || item.file.name.replace(/\.[^.]+$/, ""));
              if (item.subtypeId) formData.set(`referenceSubtypeId_${key}`, item.subtypeId);
            }
            if (item.mode === "existing" && item.documentId) formData.set(`referenceDocumentId_${key}`, item.documentId);
          });
        });
      }
      formData.set("submissionKey", crypto.randomUUID());
      formData.set("fieldValues", JSON.stringify(cleanValues(headerFields, headerValues)));
      if (showLineItems) formData.set("lineItems", JSON.stringify(cleanLines));
      // Values confirmed on the scan review page belong to one file each (fieldValues_0, lineItems_0, ...).
      if (usingScan) {
        selectedFiles.forEach((file, index) => {
          const confirmed = scan.confirmedFor(fileKey(file));
          if (!confirmed) return;
          formData.set(`fieldValues_${index}`, JSON.stringify(cleanValues(headerFields, confirmed.header)));
          if (showLineItems) {
            formData.set(`lineItems_${index}`, JSON.stringify(confirmed.lines.map((line) => cleanValues(lineFields, line)).filter((line) => Object.keys(line).length > 0)));
          }
        });
      }
      selectedFiles.forEach((file, index) => {
        formData.append("files", file);
        formData.append("fileTitles", fileTitles[index] || file.name.replace(/\.[^.]+$/, ""));
        formData.append("fileDescriptions", fileDescriptions[index] ?? description);
      });

      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "x-csrf-token": getCsrfTokenFromBrowser() },
        body: formData,
      });

      const result = (await response.json()) as { message?: string; processRunId?: string | null; signUrl?: string | null };
      if (!response.ok) {
        setError(result.message || "Failed to create document.");
        setIsSubmitting(false);
        return;
      }

      setIsSubmitting(false);
      resetForm();

      // The uploader is the approver of the first level and it needs their signature: open it for signing now.
      if (result.signUrl) {
        router.push(result.signUrl);
        return;
      }

      setShowToast(true);
      window.setTimeout(() => {
        setShowToast(false);
        // An Admin user who started or continued a run is taken to that run; everyone else goes back to their list.
        router.push(bulk ? "/tasks?tab=upload" : isAdmin && result.processRunId ? `/processes/${result.processRunId}` : process ? "/tasks" : defaultRedirectPath);
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

      {scan.reviewOpen && selectedType ? (
        <DocumentScanReview
          key={`${documentTypeId}|${documentSubtypeId}|${scan.keys.join(",")}`}
          files={selectedFiles}
          keys={scan.keys}
          scans={scan.scans}
          suggestions={scan.suggestions}
          confirmedFor={scan.confirmedFor}
          headerFields={headerFields}
          lineFields={lineFields}
          showLineItems={showLineItems}
          typeLabel={[selectedType.name, selectedType.subtypes.find((subtype) => subtype.id === documentSubtypeId)?.name].filter(Boolean).join(" / ")}
          onConfirm={scan.confirm}
          onCancel={scan.closeReview}
        />
      ) : null}

      <form onSubmit={onSubmit} className="space-y-6">
        {startProcess ? (
          <section className="rounded-2xl border border-cyan-200 bg-cyan-50 p-5 shadow-sm sm:p-6">
            <h2 className="text-base font-semibold text-cyan-900">Start process: {startProcess.name}</h2>
            <p className="mt-1 text-sm text-cyan-900/80">
              Upload the first document ({startProcess.rootName}: {startProcess.typeName}{startProcess.subtypeName ? ` - ${startProcess.subtypeName}` : ""}). The run starts with it. You can add the documents of the next steps from the run page.
            </p>
          </section>
        ) : null}

        {bulk ? (
          <BulkTasksSummary
            bulk={bulk}
            entries={typeEntries}
            matchedKeys={new Set(selectedFiles.map((file) => linkChoices[fileKey(file)]?.key).filter((key): key is string => Boolean(key)))}
          />
        ) : null}

        {process ? (
          <section className="rounded-2xl border border-cyan-200 bg-cyan-50 p-5 shadow-sm sm:p-6">
            <h2 className="text-base font-semibold text-cyan-900">Next document of {process.label}</h2>
            <p className="mt-1 text-sm text-cyan-900/80">
              {process.options.length > 1
                ? "Choose which document to upload next. The process follows the path of the one you choose."
                : "Upload the next document of this process."}
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {process.options.map((option) => (
                <button
                  key={option.stepId}
                  type="button"
                  onClick={() => chooseProcessOption(option)}
                  className={`rounded-xl border px-4 py-3 text-left text-sm transition ${
                    processStepId === option.stepId
                      ? "border-2 border-cyan-500 bg-white text-cyan-800"
                      : "border-cyan-200 bg-white/70 text-slate-700 hover:border-cyan-400"
                  }`}
                >
                  <span className="block font-semibold">{option.name}</span>
                  <span className="block text-xs text-slate-500">
                    {option.typeName}{option.subtypeName ? ` - ${option.subtypeName}` : ""}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-base font-semibold text-slate-900">Document Details</h2>

          <div className="mt-4 grid grid-cols-1 gap-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Document Type <span className="text-rose-600">*</span>
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {visibleTypes.map((type) => (
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
                {documentTypes.length === 0 ? <p className="text-sm text-slate-500">No document types are set up yet.</p> : visibleTypes.length === 0 ? <p className="text-sm text-slate-500">You cannot upload any document type for this project.</p> : null}
              </div>
            </div>

            {selectedType && selectedType.subtypes.length > 0 ? (
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Sub Type <span className="text-rose-600">*</span>
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {subtypesForChoice(selectedType).filter((subtype) => !subtypeLocked || subtype.id === documentSubtypeId).map((subtype) => (
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
              {/* Shows each project's name with its director and manager; typing also searches the project code. */}
              <ProjectPicker
                id="project"
                value={projectId}
                projects={projectsForChoice}
                disabled={projectLocked}
                onChange={(next) => { setProjectTouched(true); setProjectId(next); }}
                emptyLabel={noProjectAllowed || linkedMode || process ? (linkedMode && linkedProjectId === null ? "Taken from each linked document" : "No project") : null}
                placeholder={noProjectAllowed || linkedMode || process ? (linkedMode && linkedProjectId === null ? "Taken from each linked document" : "No project") : "Select a project"}
              />
              {(() => {
                const chosen = projects.find((project) => project.id === projectId);
                if (!chosen) return null;
                const director = chosen.director?.isActive ? chosen.director.name : null;
                const manager = chosen.manager?.isActive ? chosen.manager.name : null;
                return (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
                    <span>Project Director: <span className={director ? "font-medium text-slate-900" : "text-amber-700"}>{director ?? "not set"}</span></span>
                    <span>Project Manager: <span className={manager ? "font-medium text-slate-900" : "text-amber-700"}>{manager ?? "not set"}</span></span>
                  </div>
                );
              })()}
            </div>

            <DocumentScanPanel
              files={scanEnabled ? selectedFiles : []}
              keys={scan.keys}
              scans={scan.scans}
              anyScanning={scan.anyScanning}
              allSettled={scan.allSettled}
              allConfirmed={scan.allConfirmed}
              onReview={scan.openReview}
              onManual={scan.discardConfirmed}
            />

            {headerFields.length > 0 && !usingScan ? (
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

            {showLineItems && !usingScan ? (
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
                placeholder={selectedFiles.length > 1 ? "Add optional context for approvers (copied to every file; change it per file below)" : "Add optional context for approvers"}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none ring-cyan-300 transition focus:ring-2"
              />
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-base font-semibold text-slate-900">Upload File</h2>
          <p className="mt-1 text-xs text-slate-500">
            Accepted: PDF, Word, Excel, JPG, JPEG, PNG.{singleFile ? "" : " You can upload multiple files."}
          </p>
          {linkRequired && bulk ? (
            <p className="mt-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-900">
              Drop all the files at once. A file whose name contains the number of the document it follows is linked to its task automatically; pick the task yourself for any file that is not.
            </p>
          ) : linkRequired ? (
            <p className={`mt-2 rounded-lg border px-3 py-2 text-xs ${typeEntries.length === 0 ? "border-amber-300 bg-amber-50 text-amber-900" : "border-cyan-200 bg-cyan-50 text-cyan-900"}`}>
              {typeEntries.length === 0
                ? "This type of document follows another document of a process, and none is waiting for it right now."
                : "This type of document follows another document of a process. Choose the document each file follows (a file name that contains its number links it automatically)."}
            </p>
          ) : null}


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
                  {process && !allowMultiple
                    ? "Upload the document for the chosen process step."
                    : process
                      ? "Upload one or more files. Each file will become its own document and its own process run, linked to the previous document."
                      : "Upload one or more files. Each file will become its own document."}
                </p>
              </div>
            </div>

            <input
              id="file-input"
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
              className="sr-only"
              multiple={!singleFile}
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
                      {fileSummary.length > 1 ? (
                        <label className="mt-2 block text-xs font-medium text-slate-600">
                          Description
                          <textarea
                            value={fileDescriptions[index] ?? description}
                            onChange={(e) => {
                              const value = e.target.value;
                              setFileDescriptions((current) => {
                                const next = [...current];
                                next[index] = value;
                                return next;
                              });
                            }}
                            rows={2}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none ring-cyan-300 transition focus:ring-2"
                            placeholder="Optional context for approvers of this file"
                          />
                          {fileDescriptions[index] !== null && fileDescriptions[index] !== undefined && fileDescriptions[index] !== description ? (
                            <button
                              type="button"
                              onClick={() => setFileDescriptions((current) => current.map((item, i) => (i === index ? null : item)))}
                              className="mt-1 text-xs font-medium text-cyan-700 hover:underline"
                            >
                              Use the description above
                            </button>
                          ) : null}
                        </label>
                      ) : null}
                      {linkRequired && selectedFiles[index] ? (
                        <div className="mt-3">
                          <label htmlFor={`linked-document-${index}`} className="block text-xs font-medium text-slate-600">
                            {bulk ? (
                              <>Awaiting document <span className="text-rose-600">*</span></>
                            ) : (
                              <>Linked document <span className="font-normal text-slate-500">(optional)</span></>
                            )}
                          </label>
                          <div className="mt-1">
                            <LinkedDocumentPicker
                              id={`linked-document-${index}`}
                              entries={typeEntries}
                              value={linkChoices[fileKey(selectedFiles[index])]?.key ?? ""}
                              auto={Boolean(linkChoices[fileKey(selectedFiles[index])]?.auto)}
                              required={Boolean(bulk)}
                              matchText={[stripExtension(file.name), fileTitles[index] ?? ""]}
                              disabled={isSubmitting}
                              onChange={(key) => setLinkChoices((current) => ({ ...current, [fileKey(selectedFiles[index])]: { key, auto: false } }))}
                            />
                          </div>
                          {entryForFile(index) ? (
                            <p className="mt-1 text-xs text-slate-600">
                              Project: <span className="font-medium text-slate-800">{entryForFile(index)?.projectLabel ?? "No project"}</span> (taken from the linked document)
                            </p>
                          ) : null}
                          {(() => {
                            // Bulk upload: the run could also go on with another document, so the uploader confirms this one.
                            const entry = entryForFile(index);
                            const others = bulk && entry ? bulk.siblings[entry.key] ?? [] : [];
                            if (!entry || others.length === 0) return null;
                            const confirmKey = `${fileKey(selectedFiles[index])}|${entry.key}`;
                            return (
                              <label className={`mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${confirmedBranches[confirmKey] ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
                                <input
                                  type="checkbox"
                                  checked={Boolean(confirmedBranches[confirmKey])}
                                  onChange={(event) => setConfirmedBranches((current) => ({ ...current, [confirmKey]: event.target.checked }))}
                                  className="mt-0.5 h-4 w-4 rounded border-amber-400"
                                />
                                <span>
                                  Continue this process with <span className="font-semibold">{entry.option.name}</span>.
                                  <span className="block opacity-80">It could also continue with {others.join(", ")}; the process follows the document you upload.</span>
                                </span>
                              </label>
                            );
                          })()}
                        </div>
                      ) : null}
                      {referenceAvailable && referenceType && referenceConfig ? (
                        <>
                          {(references[index] ?? [blankReference()]).map((entry, position) => (
                            <ReferencePicker
                              key={position}
                              index={`${index}-${position}`}
                              value={entry}
                              onChange={(next) =>
                                setReferences((current) =>
                                  current.map((list, i) => (i === index ? (list.length === 0 ? [next] : list.map((item, p) => (p === position ? next : item))) : list)),
                                )
                              }
                              onRemove={position > 0 ? () => setReferences((current) => current.map((list, i) => (i === index ? list.filter((_, p) => p !== position) : list))) : undefined}
                              type={referenceType}
                              config={referenceConfig}
                              projectId={linkRequired ? entryForFile(index)?.projectId ?? "" : projectId}
                              needsSubtype={needsReferenceSubtype}
                              onError={setError}
                            />
                          ))}
                          <button
                            type="button"
                            onClick={() => setReferences((current) => current.map((list, i) => (i === index ? [...(list.length === 0 ? [blankReference()] : list), blankReference()] : list)))}
                            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-cyan-700 hover:underline"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Add another reference document
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
                      setFileTitles((current) => current.filter((_, itemIndex) => itemIndex !== index));
                      setFileDescriptions((current) => current.filter((_, itemIndex) => itemIndex !== index));
                      setReferences((current) => current.filter((_, itemIndex) => itemIndex !== index));
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

        {uniqueTracks.length > 0 && !(isAdmin && alreadyApproved) ? (
          <section className="rounded-2xl border border-cyan-200 bg-cyan-50 p-5 shadow-sm sm:p-6">
            <p className="text-sm font-semibold text-cyan-950">Unique tracks</p>
            <div className="mt-2 space-y-2">
              {uniqueTracks.map((track) => (
                <label key={track.sortOrder} className="flex items-start gap-3 text-sm text-cyan-950">
                  <input
                    type="checkbox"
                    checked={trackSortOrder === track.sortOrder}
                    onChange={(e) => setTrackSortOrder(e.target.checked ? track.sortOrder : null)}
                    className="mt-0.5 h-4 w-4 rounded border-cyan-400"
                  />
                  <span>
                    <span className="block font-semibold">{track.name}</span>
                    {track.receiverName ? <span className="block text-cyan-900/80">Sends the document straight to {track.receiverName}.</span> : null}
                  </span>
                </label>
              ))}
            </div>
          </section>
        ) : null}

        {isAdmin ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm sm:p-6">
            <label className="flex items-start gap-3 text-sm text-amber-950">
              <input
                type="checkbox"
                checked={alreadyApproved}
                onChange={(e) => setAlreadyApproved(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-amber-400"
              />
              <span>
                <span className="block font-semibold">This document is already approved</span>
                <span className="block text-amber-900/80">
                  Skip the approval flow: the document is saved as approved right away{process || startProcess || bulk ? " and the process moves on to the next step" : ""}. This is recorded in its history.
                </span>
              </span>
            </label>

            {alreadyApproved ? (
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="approvedDate" className="mb-2 block text-sm font-medium text-amber-950">Approval date (optional)</label>
                  <input
                    id="approvedDate"
                    type="date"
                    value={approvedDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setApprovedDate(e.target.value)}
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-amber-900/70">Leave empty to use today. It also sets when any waiting period of the next step starts.</p>
                </div>
                {process || startProcess || bulk ? (
                  <label className="flex items-start gap-3 text-sm text-amber-950 sm:pt-7">
                    <input type="checkbox" checked={notifyNext} onChange={(e) => setNotifyNext(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-amber-400" />
                    <span>Tell the people who may upload the next document of this process</span>
                  </label>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => router.push(bulk ? "/tasks?tab=upload" : defaultRedirectPath)}
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
              alreadyApproved ? "Save as Approved" : startProcess ? "Start Process" : bulk ? (selectedFiles.length > 0 ? `Upload ${selectedFiles.length} Document${selectedFiles.length === 1 ? "" : "s"}` : "Upload Documents") : allowMultiple && selectedFiles.length > 1 ? `Create ${selectedFiles.length} Processes` : "Create Document"
            )}
          </button>
        </div>
      </form>
    </>
  );
}
