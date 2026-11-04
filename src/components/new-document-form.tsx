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
  projects: Array<{ id: string; code: string; name: string }>;
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
};

type ReferenceState = {
  mode: "none" | "upload" | "existing";
  file: File | null;
  title: string;
  subtypeId: string;
  documentId: string;
};

const blankReference = (): ReferenceState => ({ mode: "none", file: null, title: "", subtypeId: "", documentId: "" });

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

export default function NewDocumentForm({ documentTypes, projects, defaultRedirectPath = "/clerk", process = null, initialStepId = "", startProcess = null, isAdmin = false, rootReferences = [], referenceTypes = [] }: Props) {
  const router = useRouter();

  const [description, setDescription] = useState("");
  const onlyOption = process && process.options.length === 1 ? process.options[0] : null;
  // One open choice is chosen for the person; an Admin user can also arrive with the step already picked.
  const startOption = onlyOption ?? process?.options.find((option) => option.stepId === initialStepId) ?? null;
  const [processStepId, setProcessStepId] = useState(startOption?.stepId ?? "");
  const [documentTypeId, setDocumentTypeId] = useState(startOption?.documentTypeId ?? startProcess?.documentTypeId ?? "");
  const [documentSubtypeId, setDocumentSubtypeId] = useState(startOption?.documentSubtypeId ?? startProcess?.documentSubtypeId ?? "");
  // Admin only: the document is already approved (no approval flow), optionally with the date it was approved on.
  const [alreadyApproved, setAlreadyApproved] = useState(false);
  const [approvedDate, setApprovedDate] = useState("");
  const [notifyNext, setNotifyNext] = useState(false);
  const [projectId, setProjectId] = useState(process?.projectId ?? "");
  const [headerValues, setHeaderValues] = useState<FieldValues>({});
  const [lineItems, setLineItems] = useState<FieldValues[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileTitles, setFileTitles] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);
  // Optional reference document for EACH uploaded file (same position as the file).
  // Each file can carry any number of reference documents (same position as the file).
  const [references, setReferences] = useState<ReferenceState[][]>([]);

  const selectedType = documentTypes.find((type) => type.id === documentTypeId) ?? null;
  const applicableFields = useMemo(
    () => (selectedType ? selectedType.fields.filter((field) => !field.documentSubtypeId || field.documentSubtypeId === documentSubtypeId) : []),
    [selectedType, documentSubtypeId],
  );
  const headerFields = applicableFields.filter((field) => field.fieldGroup === "HEADER");
  const lineFields = applicableFields.filter((field) => field.fieldGroup === "LINE_ITEM");
  const showLineItems = Boolean(selectedType?.supportsLineItems) && lineFields.length > 0;
  const chosenOption = process?.options.find((option) => option.stepId === processStepId) ?? null;
  const typeLocked = Boolean(process) || Boolean(startProcess);
  const subtypeLocked = Boolean(chosenOption?.documentSubtypeId) || Boolean(startProcess?.documentSubtypeId);
  // "Allow multiple uploads" comes from the process setup of the chosen step: each file then becomes its own
  // follow-up run, linked to the run and the approved document it follows.
  const allowMultiple = Boolean(chosenOption?.allowMultipleUploads);
  const singleFile = (Boolean(process) && !allowMultiple) || Boolean(startProcess);
  const projectLocked = Boolean(process);
  // Inside a process only the chosen document's type is offered; elsewhere every type is.
  const visibleTypes = process || startProcess ? documentTypes.filter((type) => type.id === documentTypeId) : documentTypes;

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
    const matches = rootReferences.filter(
      (config) => config.documentTypeId === documentTypeId && (!config.documentSubtypeId || config.documentSubtypeId === documentSubtypeId),
    );
    const best = matches.find((config) => config.documentSubtypeId) ?? matches[0];
    return best ? { typeId: best.referenceDocumentTypeId, subtypeId: best.referenceDocumentSubtypeId } : null;
  }, [process, chosenOption, rootReferences, documentTypeId, documentSubtypeId]);
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
    if (!onlyOption) setProcessStepId("");
    setHeaderValues({});
    setLineItems([]);
    setSelectedFiles([]);
    setFileTitles([]);
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
    if (selectedFiles.length === 0) {
      setError("Please choose at least one file.");
      return;
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
      if (process) {
        formData.set("processInstanceId", process.instanceId);
        formData.set("processStepId", processStepId);
      }
      if (startProcess) formData.set("startProcessDefinitionId", startProcess.definitionId);
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
      });

      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "x-csrf-token": getCsrfTokenFromBrowser() },
        body: formData,
      });

      const result = (await response.json()) as { message?: string; processRunId?: string | null };
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
        // An Admin user who started or continued a run is taken to that run; everyone else goes back to their list.
        router.push(isAdmin && result.processRunId ? `/processes/${result.processRunId}` : process ? "/tasks" : defaultRedirectPath);
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
                {documentTypes.length === 0 ? <p className="text-sm text-slate-500">No document types are set up yet.</p> : null}
              </div>
            </div>

            {selectedType && selectedType.subtypes.length > 0 ? (
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Sub Type <span className="text-rose-600">*</span>
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {selectedType.subtypes.filter((subtype) => !subtypeLocked || subtype.id === documentSubtypeId).map((subtype) => (
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
                placeholder="Add optional context for approvers"
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
                              projectId={projectId}
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
                  Skip the approval flow: the document is saved as approved right away{process || startProcess ? " and the process moves on to the next step" : ""}. This is recorded in its history.
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
                {process || startProcess ? (
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
              alreadyApproved ? "Save as Approved" : startProcess ? "Start Process" : allowMultiple && selectedFiles.length > 1 ? `Create ${selectedFiles.length} Processes` : "Create Document"
            )}
          </button>
        </div>
      </form>
    </>
  );
}
