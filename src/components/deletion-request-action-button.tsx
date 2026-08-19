"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, X, Check } from "lucide-react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

type Props = {
  requestId: string;
};

export default function DeletionRequestActionButton({ requestId }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function handleAction(action: "APPROVE" | "REJECT") {
    const actionText = action === "APPROVE" ? "approve" : "reject";
    const confirmMsg = action === "APPROVE"
      ? "Approve this deletion request? The document will be deleted after approval."
      : "Reject this deletion request? The document will remain in the system.";

    const confirmed = window.confirm(confirmMsg);
    if (!confirmed) return;

    setSubmitting(true);

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
      setSubmitting(false);
    }
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => handleAction("APPROVE")}
        disabled={submitting}
        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
      >
        {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        Approve
      </button>
      <button
        type="button"
        onClick={() => handleAction("REJECT")}
        disabled={submitting}
        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-400 disabled:opacity-60"
      >
        {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
        Reject
      </button>
    </div>
  );
}
