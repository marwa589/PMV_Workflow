"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

type Props = {
  purchaseOrderId: string;
};

export default function PurchaseOrderDeleteButton({ purchaseOrderId }: Props) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!window.confirm("Delete this PO and remove the stored file from disk?")) {
      return;
    }

    setDeleting(true);

    try {
      const response = await fetch(`/api/purchase-orders/${purchaseOrderId}`, {
        method: "DELETE",
        headers: { "x-csrf-token": getCsrfTokenFromBrowser() },
      });

      const result = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(result.message || "Unable to delete purchase order.");
      }

      window.alert(result.message || "Purchase order deleted.");
      window.location.href = "/purchase-orders";
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to delete purchase order.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      className="inline-flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-60"
    >
      <Trash2 className="h-4 w-4" />
      {deleting ? "Deleting..." : "Delete PO"}
    </button>
  );
}
