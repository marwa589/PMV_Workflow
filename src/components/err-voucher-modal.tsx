"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  FilePlus2,
  FileText,
  Loader2,
  UploadCloud,
  X,
  CheckCircle2,
} from "lucide-react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

type Props = {
  errId: string;
  voucherType: "RELEASE_VOUCHER" | "RECEIPT_VOUCHER";
  buttonLabel?: string;
  canUpload: boolean;
};

export default function ErrVoucherModal({
  errId,
  voucherType,
  buttonLabel,
  canUpload,
}: Props) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [comments, setComments] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isRelease = voucherType === "RELEASE_VOUCHER";
  const defaultLabel = isRelease
    ? "Add Release Voucher"
    : "Add Receipt Voucher";
  const title = isRelease
    ? "Upload Release Voucher"
    : "Upload Receipt Voucher";
  const targetFolder = isRelease ? "ERR+Release" : "ERR+Release+Receipt";

  if (!canUpload) {
    return null;
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] || null;
    setError(null);

    if (!selected) {
      setFile(null);
      return;
    }

    if (!selected.name.toLowerCase().endsWith(".pdf") && selected.type !== "application/pdf") {
      setError("Only PDF files are supported for voucher merging.");
      setFile(null);
      return;
    }

    if (selected.size > 20 * 1024 * 1024) {
      setError("File size must not exceed 20 MB.");
      setFile(null);
      return;
    }

    setFile(selected);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!file) {
      setError("Please select a voucher PDF file.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const formData = new FormData();
      formData.set("voucherType", voucherType);
      formData.set("file", file);
      if (comments.trim()) {
        formData.set("comments", comments.trim());
      }

      const response = await fetch(`/api/errs/${errId}/vouchers`, {
        method: "POST",
        headers: {
          "x-csrf-token": getCsrfTokenFromBrowser(),
        },
        body: formData,
      });

      const data = (await response.json()) as {
        message?: string;
        success?: boolean;
      };

      if (!response.ok) {
        throw new Error(data.message || "Failed to upload voucher.");
      }

      setSuccessMessage(data.message || "Voucher uploaded and merged successfully!");
      setTimeout(() => {
        setIsOpen(false);
        setFile(null);
        setComments("");
        setSuccessMessage(null);
        router.refresh();
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setIsOpen(true);
          setError(null);
          setSuccessMessage(null);
        }}
        className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold shadow-xs transition ${
          isRelease
            ? "border border-sky-300/80 bg-sky-50 text-sky-800 hover:bg-sky-100 hover:border-sky-400"
            : "border border-emerald-300/80 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 hover:border-emerald-400"
        }`}
      >
        <FilePlus2 className="h-4 w-4" />
        {buttonLabel || defaultLabel}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-900/10">
            <button
              type="button"
              onClick={() => {
                if (!isSubmitting) setIsOpen(false);
              }}
              disabled={isSubmitting}
              className="absolute right-4 top-4 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>

            <div>
              <div className="flex items-center gap-2">
                <div
                  className={`rounded-lg p-2 ${
                    isRelease ? "bg-sky-50 text-sky-700" : "bg-emerald-50 text-emerald-700"
                  }`}
                >
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
                  <p className="text-xs text-slate-500">
                    Will be merged into the ERR package and saved in{" "}
                    <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-700">
                      {targetFolder}
                    </code>
                  </p>
                </div>
              </div>

              {error && (
                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  {error}
                </div>
              )}

              {successMessage && (
                <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  <span>{successMessage}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    Voucher PDF Document <span className="text-rose-500">*</span>
                  </label>
                  <div className="mt-1 flex justify-center rounded-xl border-2 border-dashed border-slate-300 px-6 py-6 transition hover:border-slate-400">
                    <div className="text-center">
                      <UploadCloud className="mx-auto h-10 w-10 text-slate-400" />
                      <div className="mt-2 flex text-sm text-slate-600">
                        <label className="relative cursor-pointer rounded-md font-semibold text-sky-700 focus-within:outline-hidden hover:text-sky-600">
                          <span>Choose PDF</span>
                          <input
                            type="file"
                            accept="application/pdf,.pdf"
                            onChange={handleFileChange}
                            disabled={isSubmitting}
                            className="sr-only"
                          />
                        </label>
                        <p className="pl-1">or drag and drop</p>
                      </div>
                      <p className="text-xs text-slate-500">PDF up to 20MB</p>
                      {file && (
                        <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700">
                          <FileText className="h-4 w-4 shrink-0" />
                          <span className="truncate max-w-[240px]">{file.name}</span>
                          <span className="text-sky-600">
                            ({(file.size / (1024 * 1024)).toFixed(2)} MB)
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    Comments (optional)
                  </label>
                  <textarea
                    rows={3}
                    value={comments}
                    onChange={(e) => setComments(e.target.value)}
                    disabled={isSubmitting}
                    placeholder="Add any notes about this voucher..."
                    className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm text-slate-900 shadow-xs focus:border-sky-400 focus:outline-hidden focus:ring-1 focus:ring-sky-400 disabled:bg-slate-50"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    disabled={isSubmitting}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || !file}
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
                      isRelease
                        ? "border border-sky-300 bg-sky-100 text-sky-900 hover:bg-sky-200"
                        : "border border-emerald-300 bg-emerald-100 text-emerald-900 hover:bg-emerald-200"
                    }`}
                  >
                    {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    {isSubmitting ? "Merging PDF..." : "Upload & Merge"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
