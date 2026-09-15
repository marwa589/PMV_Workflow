import { createHash } from "node:crypto";
import path from "node:path";

const KSA_AVR_UPLOADER = "dispatcher.pmv@ahmadiah.com";
const KSA_AVK_UPLOADERS = new Set([
  "joemar.paraiso@ahmadiah.com",
  "bernabie.rocha@ahmadiah.com",
  "mohamed.mahran@ahmadiah.com",
]);
const KUWAIT_UPLOADERS = new Set([
  "aqueel.sayed@ahmadiah.com",
  "mohamed.shawky@ahmadiah.com",
  "mohamed.mahmoud@ahmadiah.com",
  "jad.kabalan@ahmadiah.com",
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

export function documentStorageFolder(params: {
  uploaderEmail: string;
  documentType: "COMPARISON" | "MATERIAL_REQUISITION";
  mrType?: "CASH" | "CREDIT" | null;
  hasLinkedComparison?: boolean;
}): string | null {
  const email = normalizeStorageEmail(params.uploaderEmail);
  const location = email === KSA_AVR_UPLOADER
    ? "KSA/AVR"
    : KSA_AVK_UPLOADERS.has(email)
      ? "KSA/AVK"
      : KUWAIT_UPLOADERS.has(email)
        ? "Kuwait"
        : null;

  if (!location) return null;
  if (params.documentType === "COMPARISON") return `MRs/${location}/Comparisons`;
  if (params.hasLinkedComparison) return `MRs/${location}/MRs+Comparisons`;
  return `MRs/${location}/MRs ${params.mrType === "CREDIT" ? "credit" : "cash"}`;
}

export function purchaseOrderStorageFolder(uploaderEmail: string): string {
  const email = normalizeStorageEmail(uploaderEmail);
  const location = email === KSA_AVR_UPLOADER
    ? "KSA/AVR"
    : KSA_AVK_UPLOADERS.has(email)
      ? "KSA/AVK"
      : KUWAIT_UPLOADERS.has(email)
        ? "Kuwait"
        : null;

  return location ? `${location}/POs` : "POs";
}

export function folderFromStoredPath(filePath?: string | null): string | null {
  if (!filePath) return null;
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized.startsWith("uploads/")) return path.posix.dirname(normalized);
  const folder = path.posix.dirname(normalized);
  return folder === "." ? null : folder;
}
