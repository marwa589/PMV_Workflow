type WorkflowStatus =
  | "PENDING_APPROVER_1"
  | "PENDING_APPROVER_2"
  | "PENDING_APPROVER_3"
  | "APPROVED"
  | "REJECTED"
  | "REVISION_REQUIRED"
  | "ARCHIVED"
  | "PENDING"
  | "ON_HOLD";

const badgeClasses: Record<WorkflowStatus, string> = {
  PENDING_APPROVER_1: "bg-yellow-50 text-yellow-900 ring-1 ring-yellow-200",
  PENDING_APPROVER_2: "bg-yellow-50 text-yellow-900 ring-1 ring-yellow-200",
  PENDING_APPROVER_3: "bg-yellow-50 text-yellow-900 ring-1 ring-yellow-200",
  APPROVED: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200",
  REJECTED: "bg-rose-50 text-rose-900 ring-1 ring-rose-200",
  REVISION_REQUIRED: "bg-orange-50 text-orange-900 ring-1 ring-orange-200",
  ARCHIVED: "bg-slate-100 text-slate-800 ring-1 ring-slate-300",
  PENDING: "bg-yellow-50 text-yellow-900 ring-1 ring-yellow-200",
  ON_HOLD: "bg-sky-50 text-sky-900 ring-1 ring-sky-200",
};

export function statusLabel(status: string): string {
  switch (status) {
    case "PENDING_APPROVER_1":
      return "Pending PMV Engineer";
    case "PENDING_APPROVER_2":
      return "Pending Workshop Manager";
    case "PENDING_APPROVER_3":
      return "Pending PMV Manager";
    case "PENDING":
      return "Pending";
    case "ON_HOLD":
      return "On Hold";
    case "APPROVED":
      return "Approved";
    case "REJECTED":
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
