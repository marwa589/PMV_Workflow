import { DocumentStatus } from "@prisma/client";

export type AgeBucket = "UNDER_3_HOURS" | "BETWEEN_3_AND_24_HOURS" | "OVER_24_HOURS";

export function getAgeBucket(hours: number): AgeBucket {
  if (hours <= 3) return "UNDER_3_HOURS";
  if (hours <= 24) return "BETWEEN_3_AND_24_HOURS";
  return "OVER_24_HOURS";
}

export function formatWaitingTime(hours: number): string {
  if (!Number.isFinite(hours)) return "0h";
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function getWaitingHours(assignedAt: Date | null): number {
  if (!assignedAt) return 0;
  const diffMs = Date.now() - new Date(assignedAt).getTime();
  return diffMs / (1000 * 60 * 60);
}

export function getStatusColor(status: DocumentStatus): string {
  switch (status) {
    case DocumentStatus.PENDING_APPROVER_1:
      return "bg-amber-100 text-amber-900 ring-1 ring-amber-200";
    case DocumentStatus.PENDING_APPROVER_2:
      return "bg-blue-100 text-blue-900 ring-1 ring-blue-200";
    case DocumentStatus.PENDING_APPROVER_3:
      return "bg-violet-100 text-violet-900 ring-1 ring-violet-200";
    case DocumentStatus.APPROVED:
      return "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200";
    case DocumentStatus.REJECTED:
      return "bg-rose-100 text-rose-900 ring-1 ring-rose-200";
    default:
      return "bg-slate-100 text-slate-900 ring-1 ring-slate-200";
  }
}
