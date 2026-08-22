"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

type Props = {
  documentId: string;
};

export default function DocumentDeleteButton({ documentId }: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    const confirmed = window.confirm(
      "Send a deletion request to Admin for approval?",
    );

    if (!confirmed) {
      return;
    }

    setDeleting(true);

    try {
      const response = await fetch("/api/documents/deletion-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": getCsrfTokenFromBrowser(),
        },
        body: JSON.stringify({ ids: [documentId] }),
      });

      const result = (await response.json()) as { message?: string };
      if (!response.ok) {
        window.alert(result.message || "Failed to send deletion request.");
        return;
      }

      window.alert(result.message || "Deletion request sent to Admin.");
      router.refresh();
    } catch {
      window.alert("Unexpected error while sending the deletion request.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      className="inline-flex items-center gap-2 rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
    >
      {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      Request delete
    </button>
  );
}
