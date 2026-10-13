"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, ArchiveRestore, PackageCheck } from "lucide-react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

type Props = {
  documentId: string;
  canConfirmReceipt: boolean;
  canArchive: boolean;
  isArchived: boolean;
  // Archiving is only allowed from approved or rejected documents.
  canBeArchived: boolean;
};

/** Receipt confirmation and archive / restore for one document. Shown only when the person holds the permission. */
export default function DocumentDetailActions({ documentId, canConfirmReceipt, canArchive, isArchived, canBeArchived }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"receipt" | "archive" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function call(kind: "receipt" | "archive", url: string, body?: unknown) {
    setBusy(kind);
    setMessage(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": getCsrfTokenFromBrowser() },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setMessage(data.message || "Something went wrong.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const buttonClass =
    "inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";

  return (
    <>
      {canConfirmReceipt ? (
        <button type="button" disabled={busy !== null} onClick={() => call("receipt", `/api/documents/${documentId}/received`)} className={buttonClass}>
          <PackageCheck className="h-4 w-4" />
          {busy === "receipt" ? "Saving..." : "Confirm received"}
        </button>
      ) : null}
      {canArchive && (isArchived || canBeArchived) ? (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => call("archive", `/api/documents/${documentId}/archive`, { archived: !isArchived })}
          className={buttonClass}
        >
          {isArchived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          {busy === "archive" ? "Saving..." : isArchived ? "Restore from archive" : "Archive"}
        </button>
      ) : null}
      {message ? <span className="text-sm text-rose-600">{message}</span> : null}
    </>
  );
}
