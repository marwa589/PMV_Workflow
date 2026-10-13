import { createHash } from "node:crypto";
import path from "node:path";

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

/**
 * Where a document's files are stored, built only from data (no hard-coded people or places):
 *   Documents/{Location}/{Project code}/{Type code}[/{Sub type code}]
 * A missing location or project becomes "No Location" / "No Project".
 */
export function documentStorageFolder(params: {
  locationName?: string | null;
  projectCode?: string | null;
  documentTypeCode: string;
  documentSubtypeCode?: string | null;
}): string {
  const segments = [
    "Documents",
    safeStorageFolderName(params.locationName?.trim() || "No Location"),
    safeStorageFolderName(params.projectCode?.trim() || "No Project"),
    safeStorageFolderName(params.documentTypeCode),
  ];

  if (params.documentSubtypeCode?.trim()) {
    segments.push(safeStorageFolderName(params.documentSubtypeCode));
  }

  return segments.join("/");
}

export function folderFromStoredPath(filePath?: string | null): string | null {
  if (!filePath) return null;
  const normalized = filePath.replaceAll("\\", "/");
  const folder = path.posix.dirname(normalized);
  return folder === "." ? null : folder;
}
