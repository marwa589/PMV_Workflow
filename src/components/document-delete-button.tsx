"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";

type Props = {
  documentId: string;
};

export default function DocumentDeleteButton({ documentId }: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    const confirmed = window.confirm(
      "Are you sure you want to permanently delete this document and all related versions and history?",
    );

    if (!confirmed) {
      return;
    }

    setDeleting(true);

    try {
      const response = await fetch(`/api/documents/${documentId}/delete`, {
        method: "POST",
      });

      const result = (await response.json()) as { message?: string };
      if (!response.ok) {
        window.alert(result.message || "Failed to delete document.");
        return;
      }

      router.refresh();
    } catch {
      window.alert("Unexpected error while deleting the document.");
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
      Delete
    </button>
  );
}
