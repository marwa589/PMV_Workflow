import { statusToneClasses } from "@/lib/status-colors";
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

export function getStatusColor(status: DocumentStatus, downloaded = false): string {
  return statusToneClasses(status, downloaded);
}
