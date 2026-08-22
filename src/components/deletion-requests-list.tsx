"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckSquare, Square, Check, X } from "lucide-react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

type DeletionRequest = {
  id: string;
  documentId: string;
  createdAt: Date;
  requestedBy: { name: string; email: string };
  document: { documentNumber: string; title: string };
};

type Props = {
  requests: DeletionRequest[];
};

export default function DeletionRequestsList({ requests }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [processingBulk, setProcessingBulk] = useState(false);
  const [processingIndividual, setProcessingIndividual] = useState<Set<string>>(new Set());

  const allSelected = selected.size === requests.length && requests.length > 0;
  const someSelected = selected.size > 0 && selected.size < requests.length;

  function toggleSelectAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(requests.map((r) => r.id)));
    }
  }

  function toggleSelect(id: string) {
    const newSelected = new Set(selected);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelected(newSelected);
  }

  async function handleIndividualAction(requestId: string, action: "APPROVE" | "REJECT") {
    const actionText = action === "APPROVE" ? "approve" : "reject";
    const confirmMsg = action === "APPROVE"
      ? "Approve this deletion request? The document will be deleted after Admin approval."
      : "Reject this deletion request? The document will remain in the system.";

    const confirmed = window.confirm(confirmMsg);
    if (!confirmed) return;

    const newProcessing = new Set(processingIndividual);
    newProcessing.add(requestId);
    setProcessingIndividual(newProcessing);

    try {
      const form = new FormData();
      form.set("decision", action);

      const response = await fetch(`/api/documents/deletion-requests/${requestId}`, {
        method: "POST",
        headers: { "x-csrf-token": getCsrfTokenFromBrowser() },
        body: form,
      });

      const result = (await response.json()) as { message?: string };
      if (!response.ok) {
        window.alert(result.message || `Failed to ${actionText} deletion request.`);
        return;
      }

      window.alert(result.message || `Deletion request ${actionText}ed.`);
      router.refresh();
    } catch {
      window.alert(`Unexpected error while ${actionText}ing the deletion request.`);
    } finally {
      const newProcessing = new Set(processingIndividual);
      newProcessing.delete(requestId);
      setProcessingIndividual(newProcessing);
    }
  }

  async function handleBulkAction(action: "APPROVE" | "REJECT") {
    if (selected.size === 0) return;

    const actionText = action === "APPROVE" ? "approve and delete" : "reject";
    const confirmMsg = action === "APPROVE"
      ? `Approve and delete ${selected.size} document(s)?`
      : `Reject deletion of ${selected.size} document(s)?`;

    const confirmed = window.confirm(confirmMsg);
    if (!confirmed) return;

    setProcessingBulk(true);

    try {
      const response = await fetch("/api/documents/deletion-requests/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": getCsrfTokenFromBrowser(),
        },
        body: JSON.stringify({
          requestIds: Array.from(selected),
          action,
        }),
      });

      const result = (await response.json()) as { message?: string; processedCount?: number };
      if (!response.ok) {
        window.alert(result.message || `Failed to ${actionText} deletion requests.`);
        return;
      }

      window.alert(`${result.processedCount || selected.size} deletion request(s) ${actionText}ed.`);
      setSelected(new Set());
      router.refresh();
    } catch {
      window.alert(`Unexpected error while performing bulk ${actionText}.`);
    } finally {
      setProcessingBulk(false);
    }
  }

  if (requests.length === 0) {
    return <div className="px-5 py-6 text-sm text-slate-500">No deletion requests pending.</div>;
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="border-b border-slate-200 bg-blue-50 px-5 py-3">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <p className="text-sm font-medium text-blue-900">
              {selected.size} deletion request{selected.size !== 1 ? "s" : ""} selected
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleBulkAction("APPROVE")}
                disabled={processingBulk}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                {processingBulk ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve Selected"}
              </button>
              <button
                type="button"
                onClick={() => handleBulkAction("REJECT")}
                disabled={processingBulk}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-400 disabled:opacity-60"
              >
                {processingBulk ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reject Selected"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="divide-y divide-slate-100">
        {requests.map((request) => (
          <div key={request.id} className="px-5 py-4 hover:bg-slate-50">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex gap-3 flex-1">
                <button
                  type="button"
                  onClick={() => toggleSelect(request.id)}
                  className="mt-1 flex flex-shrink-0 items-center justify-center rounded p-1 hover:bg-slate-200"
                >
                  {selected.has(request.id) ? (
                    <CheckSquare className="h-5 w-5 text-blue-600" />
                  ) : (
                    <Square className="h-5 w-5 text-slate-400" />
                  )}
                </button>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-900">
                    {request.document.documentNumber} - {request.document.title}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Requested by {request.requestedBy.name} ({request.requestedBy.email}) on{" "}
                    {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(request.createdAt)}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleIndividualAction(request.id, "APPROVE")}
                  disabled={processingIndividual.has(request.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
                >
                  {processingIndividual.has(request.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => handleIndividualAction(request.id, "REJECT")}
                  disabled={processingIndividual.has(request.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-400 disabled:opacity-60"
                >
                  {processingIndividual.has(request.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  Reject
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
