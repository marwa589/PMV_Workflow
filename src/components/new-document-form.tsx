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
  UploadCloud,
  XCircle,
} from "lucide-react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

type FileKind = "pdf" | "docx" | "xlsx" | "image" | "unknown";
type DocumentTypeOption = "COMPARISON" | "MATERIAL_REQUISITION";
type MrTypeOption = "CASH" | "CREDIT";
type ComparisonTypeOption = "SPARE_PARTS" | "OTHER";

const ACCEPTED_EXTENSIONS = ["pdf", "docx", "xlsx", "jpg", "jpeg", "png"];
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

export default function NewDocumentForm({ defaultRedirectPath = "/clerk" }: { defaultRedirectPath?: string }) {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [documentType, setDocumentType] = useState<DocumentTypeOption | null>(null);
  const [comparisonType, setComparisonType] = useState<ComparisonTypeOption | null>(null);
  const [mrType, setMrType] = useState<MrTypeOption | null>(null);
  const [mrNumber, setMrNumber] = useState("");
  const [comparisonLinkChoice, setComparisonLinkChoice] = useState<"YES" | "NO" | null>(null);
  const [comparisonSearch, setComparisonSearch] = useState("");
  const [comparisonOptions, setComparisonOptions] = useState<Array<{ id: string; documentNumber: string; title: string; approvedAt: string }>>([]);
  const [selectedComparisonId, setSelectedComparisonId] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileTitles, setFileTitles] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);

  const fileSummary = useMemo(() => {
    if (selectedFiles.length === 0) return null;
    return selectedFiles.map((file) => ({
      name: file.name,
      size: formatBytes(file.size),
      type: file.type || "Unknown MIME type",
    }));
  }, [selectedFiles]);

  function handleFileSelection(files: FileList | File[] | null) {
    const incomingFiles = Array.from(files ?? []);
    if (incomingFiles.length === 0) return;

    const invalid = incomingFiles.find((file) => !isAcceptedFile(file));
    if (invalid) {
      setError("Unsupported file type. Allowed: PDF, DOCX, XLSX, JPG, JPEG, PNG.");
      return;
    }

    setError(null);
    const uniqueIncomingFiles = incomingFiles.filter((file) => !selectedFiles.some((existing) => existing.name === file.name && existing.size === file.size));
    setSelectedFiles((current) => [...current, ...uniqueIncomingFiles]);
    setFileTitles((current) => [...current, ...uniqueIncomingFiles.map((file) => file.name.replace(/\.[^.]+$/, ""))]);
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
    setTitle("");
    setDescription("");
    setDocumentType(null);
    setComparisonType(null);
    setMrType(null);
    setMrNumber("");
    setComparisonLinkChoice(null);
    setComparisonSearch("");
    setComparisonOptions([]);
    setSelectedComparisonId(null);
    setSelectedFiles([]);
    setFileTitles([]);
    setError(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!documentType) {
      setError("Please select a document type.");
      return;
    }

    if (documentType === "MATERIAL_REQUISITION" && !mrType) {
      setError("Please select an MR type.");
      return;
    }

    if (documentType === "COMPARISON" && !comparisonType) {
      setError("Please select a comparison type.");
      return;
    }

    if (selectedFiles.length === 0) {
      setError("Please upload at least one file before creating.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.set("title", title);
      formData.set("description", description);
      formData.set("documentType", documentType);
      if (documentType === "COMPARISON" && comparisonType) {
        formData.set("comparisonType", comparisonType);
      }
      if (documentType === "MATERIAL_REQUISITION") {
        if (mrType) {
          formData.set("mrType", mrType);
        }
        if (mrNumber.trim()) {
          formData.set("mrNumber", mrNumber.trim());
        }
        if (comparisonLinkChoice === "YES" && selectedComparisonId) {
          formData.set("relatedComparisonId", selectedComparisonId);
        } else {
          formData.set("relatedComparisonId", "");
        }
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
        router.push(defaultRedirectPath);
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
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-base font-semibold text-slate-900">Document Details</h2>

          <div className="mt-4 grid grid-cols-1 gap-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Document Type <span className="text-rose-600">*</span>
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[
                  { value: "COMPARISON", label: "Comparison Sheet" },
                  { value: "MATERIAL_REQUISITION", label: "Material Requisition" },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setDocumentType(option.value as DocumentTypeOption);
                      if (option.value === "COMPARISON") {
                        setMrType(null);
                      } else {
                        setComparisonType(null);
                      }
                    }}
                    className={`rounded-xl border px-4 py-3 text-left text-sm font-medium transition ${
                      documentType === option.value
                        ? "border-cyan-500 bg-cyan-50 text-cyan-700"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {documentType === "COMPARISON" ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <label className="block text-sm font-medium text-slate-700">
                  Comparison Type <span className="text-rose-600">*</span>
                </label>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {[
                    { value: "SPARE_PARTS", label: "Spare Parts Comparison" },
                    { value: "OTHER", label: "Other Comparison" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setComparisonType(option.value as ComparisonTypeOption)}
                      className={`rounded-xl border px-4 py-3 text-left text-sm font-medium transition ${
                        comparisonType === option.value
                          ? "border-cyan-500 bg-cyan-50 text-cyan-700"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {documentType === "MATERIAL_REQUISITION" ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <label className="block text-sm font-medium text-slate-700">
                    MR Details <span className="text-rose-600">*</span>
                  </label>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label htmlFor="mr-number" className="mb-2 block text-sm font-medium text-slate-700">
                      MR Number
                    </label>
                    <input
                      id="mr-number"
                      type="text"
                      value={mrNumber}
                      onChange={(e) => setMrNumber(e.target.value)}
                      placeholder="e.g. 205523"
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none ring-cyan-300 transition focus:ring-2"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">
                      MR Type <span className="text-rose-600">*</span>
                    </label>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {[
                        { value: "CASH", label: "Cash" },
                        { value: "CREDIT", label: "Credit" },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setMrType(option.value as MrTypeOption)}
                          className={`rounded-xl border px-4 py-3 text-left text-sm font-medium transition ${
                            mrType === option.value
                              ? "border-cyan-500 bg-cyan-50 text-cyan-700"
                              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                  <label className="block text-sm font-medium text-slate-700">
                    Does this MR have a related Comparison?
                  </label>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {(["YES", "NO"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          setComparisonLinkChoice(option);
                          if (option === "NO") {
                            setSelectedComparisonId(null);
                            setComparisonSearch("");
                            setComparisonOptions([]);
                          }
                        }}
                        className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
                          comparisonLinkChoice === option
                            ? "border-cyan-500 bg-cyan-50 text-cyan-700"
                            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {option === "YES" ? "Yes" : "No"}
                      </button>
                    ))}
                  </div>

                  {comparisonLinkChoice === "YES" ? (
                    <div className="mt-4 space-y-3">
                      <input
                        value={comparisonSearch}
                        onChange={async (event) => {
                          const value = event.target.value;
                          setComparisonSearch(value);
                          if (!value.trim()) {
                            setComparisonOptions([]);
                            return;
                          }

                          try {
                            const response = await fetch(`/api/documents/comparisons?search=${encodeURIComponent(value.trim())}`);
                            const result = (await response.json()) as { comparisons?: Array<{ id: string; documentNumber: string; title: string; approvedAt: string }> };
                            setComparisonOptions(result.comparisons || []);
                          } catch {
                            setComparisonOptions([]);
                          }
                        }}
                        placeholder="Search approved comparisons"
                        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none ring-cyan-300 transition focus:ring-2"
                      />
                      {comparisonOptions.length > 0 ? (
                        <div className="max-h-48 space-y-2 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
                          {comparisonOptions.map((comparison) => (
                            <button
                              key={comparison.id}
                              type="button"
                              onClick={() => setSelectedComparisonId(comparison.id)}
                              className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                                selectedComparisonId === comparison.id
                                  ? "border-cyan-500 bg-cyan-100 text-cyan-800"
                                  : "border-transparent bg-white text-slate-700 hover:border-slate-200"
                              }`}
                            >
                              <div className="font-semibold">{comparison.documentNumber}</div>
                              <div className="text-xs text-slate-600">{comparison.title}</div>
                              <div className="mt-1 text-[11px] text-slate-500">Approved {comparison.approvedAt}</div>
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {selectedComparisonId ? (
                        <p className="text-sm text-slate-600">
                          Selected comparison: <span className="font-semibold text-slate-900">{comparisonOptions.find((item) => item.id === selectedComparisonId)?.documentNumber || "Selected"}</span>
                        </p>
                      ) : (
                        <p className="text-sm text-slate-500">Search and select one approved comparison.</p>
                      )}
                    </div>
                  ) : null}
                </div>

                <p className="mt-3 text-sm text-slate-600">
                  Enter the MR number and choose the MR type manually before saving.
                </p>
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
          <p className="mt-1 text-xs text-slate-500">Accepted: PDF, DOCX, XLSX, JPG, JPEG, PNG. You can upload multiple files.</p>

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
                  {documentType === "MATERIAL_REQUISITION"
                    ? "Choose the MR type above, then upload the file for this requisition."
                    : "Upload one or more files. Each file will become its own document."}
                </p>
              </div>
            </div>

            <input
              id="file-input"
              type="file"
              accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png"
              className="sr-only"
              multiple
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
