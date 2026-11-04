import { statusToneClasses } from "@/lib/status-colors";

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

// `downloaded`: the viewing user has downloaded this document (turns an approved badge green).
export default function StatusBadge({ status, label, downloaded = false }: { status: string; label?: string; downloaded?: boolean }) {
  const badgeClass = statusToneClasses(status, downloaded);

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${badgeClass}`}>
      {label || statusLabel(status)}
    </span>
  );
}
