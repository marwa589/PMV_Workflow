// One place for the system-wide colour code:
//   pending -> yellow, rejected -> red, approved -> blue, approved and downloaded (by the viewing user) -> green.
// Other statuses: revision required -> orange, on hold -> violet, archived -> grey.
export type StatusTone = "yellow" | "red" | "blue" | "green" | "orange" | "violet" | "grey";

export const TONE_CLASSES: Record<StatusTone, string> = {
  yellow: "bg-yellow-50 text-yellow-900 ring-1 ring-yellow-200",
  red: "bg-red-50 text-red-900 ring-1 ring-red-200",
  blue: "bg-blue-50 text-blue-900 ring-1 ring-blue-200",
  green: "bg-green-50 text-green-900 ring-1 ring-green-200",
  orange: "bg-orange-50 text-orange-900 ring-1 ring-orange-200",
  violet: "bg-violet-50 text-violet-900 ring-1 ring-violet-200",
  grey: "bg-slate-100 text-slate-800 ring-1 ring-slate-300",
};

/** Tone for a document status. `downloaded` = the viewing user has downloaded it; only matters when approved. */
export function statusTone(status: string, downloaded = false): StatusTone {
  switch (status) {
    case "PENDING":
      return "yellow";
    case "CANCELLED":
      return "red";
    case "APPROVED":
      return downloaded ? "green" : "blue";
    case "REVISION_REQUIRED":
      return "orange";
    case "ON_HOLD":
      return "violet";
    default:
      return "grey";
  }
}

export function statusToneClasses(status: string, downloaded = false): string {
  return TONE_CLASSES[statusTone(status, downloaded)];
}
