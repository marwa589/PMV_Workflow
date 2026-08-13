"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

type Props = {
  requestId: string;
};

export default function DeletionRequestActionButton({ requestId }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function handleApprove() {
    const confirmed = window.confirm("Approve this deletion request? The document will be deleted after approval.");
    if (!confirmed) return;

    setSubmitting(true);

    try {
      const form = new FormData();
      form.set("decision", "APPROVE");

      const response = await fetch(`/api/documents/deletion-requests/${requestId}`, {
        method: "POST",
        headers: { "x-csrf-token": getCsrfTokenFromBrowser() },
        body: form,
      });

      const result = (await response.json()) as { message?: string };
      if (!response.ok) {
        window.alert(result.message || "Failed to approve deletion request.");
        return;
      }

      window.alert(result.message || "Document deleted.");
      router.refresh();
    } catch {
      window.alert("Unexpected error while approving the deletion request.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleApprove}
      disabled={submitting}
      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
    >
      {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Approve"}
    </button>
  );
}
