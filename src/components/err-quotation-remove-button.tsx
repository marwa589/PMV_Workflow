"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

export default function ErrQuotationRemoveButton({
  errId,
  fileId,
  fileName,
}: {
  errId: string;
  fileId: string;
  fileName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function removeQuotation() {
    if (!window.confirm(`Remove attached quotation "${fileName}"?`)) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/errs/${errId}/quotations`, {
        method: "DELETE",
        headers: { "x-csrf-token": getCsrfTokenFromBrowser() },
        body: JSON.stringify({ fileId }),
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message || "Unable to remove quotation.");
      router.refresh();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Unable to remove quotation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void removeQuotation()}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
      >
        <Trash2 size={14} aria-hidden="true" />
        {busy ? "Removing..." : "Remove"}
      </button>
      {error ? <span role="alert" className="max-w-48 text-right text-xs text-rose-700">{error}</span> : null}
    </div>
  );
}