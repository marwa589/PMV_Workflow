import { createHash } from "node:crypto";
import path from "node:path";

const KSA_AVR_UPLOADER = "dispatcher.pmv@ahmadiah.com";
const KSA_AVK_UPLOADERS = new Set([
  "joemar.paraiso@ahmadiah.com",
  "bernabie.rocha@ahmadiah.com",
  "mohamed.mahran@ahmadiah.com",
  //temp
  "joemar.paraiso@example.com",
  "bernabie.rocha@example.com",
  "mohamed.mahran@example.com",
]);
const KUWAIT_UPLOADERS = new Set([
  "aqueel.sayed@ahmadiah.com",
  "mohamed.shawky@ahmadiah.com",
  "mohamed.mahmoud@ahmadiah.com",
  "jad.kabalan@ahmadiah.com",
  //temp
  "aqueel.sayed@example.com",
  "mohamed.shawky@example.com",
  "mohamed.mahmoud@example.com",
  "jad.kabalan@example.com",
]);

export function normalizeStorageEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function storageCountryFolder(country: "KSA" | "KUWAIT"): "KSA" | "Kuwait" {
  return country === "KSA" ? "KSA" : "Kuwait";
}

export function safeStorageFolderName(value: string): string {
  const original = value.trim();
  if (!original) throw new Error("A storage folder name is required.");

  let safe = original.replace(/[%<>:"/\\|?*\u0000-\u001f]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
  safe = safe.replace(/[. ]+$/g, (ending) =>
    Array.from(ending, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`).join(""),
  );

  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)) {
    safe = `%${safe.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}${safe.slice(1)}`;
  }

  const maxLength = 96;
  if (safe.length <= maxLength) return safe;
  const suffix = createHash("sha256").update(original).digest("hex").slice(0, 12);
  return `${safe.slice(0, maxLength - suffix.length - 1)}-${suffix}`;
}

export function resolveStorageLocationFromUser(location?: string | null, uploaderEmail?: string): string | null {
  const normalizedLocation = location?.trim().toUpperCase();
  if (normalizedLocation === "AVR") return "KSA";
  if (normalizedLocation === "AVK") return "KSA";
  if (normalizedLocation === "KUWAIT") return "Kuwait";

  if (!uploaderEmail) return null;

  const email = normalizeStorageEmail(uploaderEmail);
  if (email === KSA_AVR_UPLOADER) return "KSA";
  if (KSA_AVK_UPLOADERS.has(email)) return "KSA";
  if (KUWAIT_UPLOADERS.has(email)) return "Kuwait";

  return null;
}

function resolveStorageGroupFromUser(location?: string | null, uploaderEmail?: string): "AVR" | "AVK" | null {
  const normalizedLocation = location?.trim().toUpperCase();
  if (normalizedLocation === "AVR") return "AVR";
  if (normalizedLocation === "AVK") return "AVK";

  if (!uploaderEmail) return null;

  const email = normalizeStorageEmail(uploaderEmail);
  if (email === KSA_AVR_UPLOADER) return "AVR";
  if (KSA_AVK_UPLOADERS.has(email)) return "AVK";
  return null;
}

export function documentStorageFolder(params: {
  uploaderEmail: string;
  location?: string | null;
  documentType: "COMPARISON" | "MATERIAL_REQUISITION";
  mrType?: "CASH" | "CREDIT" | null;
  hasLinkedComparison?: boolean;
}): string | null {
  const location = resolveStorageLocationFromUser(params.location, params.uploaderEmail);
  const group = resolveStorageGroupFromUser(params.location, params.uploaderEmail);

  if (!location) return null;

  const baseFolder = location === "KSA" && group ? `MRs/${location}/${group}` : `MRs/${location}`;

  if (params.documentType === "COMPARISON") {
    return `${baseFolder}/Comparisons`;
  }

  if (params.mrType === "CREDIT") {
    return `${baseFolder}/MRs Credit`;
  }

  if (params.mrType === "CASH") {
    return `${baseFolder}/MRs Cash`;
  }

  return `${baseFolder}/MRs`;
}

export function purchaseOrderStorageFolder(uploaderEmail: string): string {
  const location = resolveStorageLocationFromUser(null, uploaderEmail);
  const group = resolveStorageGroupFromUser(null, uploaderEmail);

  if (!location) return "POs";
  const baseFolder = location === "KSA" && group ? `MRs/${location}/${group}` : `MRs/${location}`;
  return `${baseFolder}/POs`;
}

export function folderFromStoredPath(filePath?: string | null): string | null {
  if (!filePath) return null;
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized.startsWith("uploads/")) return path.posix.dirname(normalized);
  const folder = path.posix.dirname(normalized);
  return folder === "." ? null : folder;
}
