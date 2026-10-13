type WorkflowStatus = "PENDING" | "REVISION_REQUIRED" | "ON_HOLD" | "APPROVED" | "CANCELLED" | "ARCHIVED";

const badgeClasses: Record<WorkflowStatus, string> = {
  PENDING: "bg-yellow-50 text-yellow-900 ring-1 ring-yellow-200",
  APPROVED: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200",
  CANCELLED: "bg-rose-50 text-rose-900 ring-1 ring-rose-200",
  REVISION_REQUIRED: "bg-orange-50 text-orange-900 ring-1 ring-orange-200",
  ARCHIVED: "bg-slate-100 text-slate-800 ring-1 ring-slate-300",
  ON_HOLD: "bg-sky-50 text-sky-900 ring-1 ring-sky-200",
};

// Fallback text. Pages normally pass `label`, which also names the level a pending document waits at.
export function statusLabel(status: string): string {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "ON_HOLD":
      return "On Hold";
    case "APPROVED":
      return "Approved";
    case "CANCELLED":
      return "Rejected";
    case "REVISION_REQUIRED":
      return "Revision Required";
    case "ARCHIVED":
      return "Archived";
    default:
      return status;
  }
}

export default function StatusBadge({ status, label }: { status: string; label?: string }) {
  const badgeClass = badgeClasses[status as WorkflowStatus] ?? "bg-slate-100 text-slate-800 ring-1 ring-slate-300";

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${badgeClass}`}>
      {label || statusLabel(status)}
    </span>
  );
}
