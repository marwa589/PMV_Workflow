"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

export default function InvoiceDeleteButton({ invoiceId }: { invoiceId: string }) {
  const [deleting, setDeleting] = useState(false);

  async function deleteInvoice() {
    if (!window.confirm("Delete this invoice and remove its stored file?")) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}`, {
        method: "DELETE",
        headers: { "x-csrf-token": getCsrfTokenFromBrowser() },
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || "Unable to delete invoice.");
      window.location.reload();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to delete invoice.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <button type="button" onClick={() => void deleteInvoice()} disabled={deleting} className="inline-flex items-center gap-1.5 font-medium text-rose-700 hover:underline disabled:opacity-50">
      <Trash2 className="h-4 w-4" />
      {deleting ? "Deleting..." : "Delete"}
    </button>
  );
}