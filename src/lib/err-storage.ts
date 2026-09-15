import type { ErrProjectCountry } from "@prisma/client";
import { safeStorageFolderName, storageCountryFolder } from "./storage-layout";

export const ERR_STORAGE_ROOT = "ERRs";

export function projectStorageFolder(country: ErrProjectCountry, projectName: string): string {
  return `${ERR_STORAGE_ROOT}/${storageCountryFolder(country)}/${safeStorageFolderName(projectName)}`;
}

export function errDocumentStorageFolder(country: ErrProjectCountry, projectName: string, fileName: string, errId: string): string {
  const nameWithoutExtension = fileName.replace(/\.[^.]+$/, "");
  return `${projectStorageFolder(country, projectName)}/${safeStorageFolderName(`${nameWithoutExtension}-${errId.slice(0, 8)}`)}`;
}

export function projectStorageFolderFromFile(filePath?: string | null): string | null {
  if (!filePath) return null;

  const parts = filePath.replaceAll("\\", "/").split("/");
  if (parts[0] === ERR_STORAGE_ROOT && parts.length === 2) return ERR_STORAGE_ROOT;
  if (parts[0] !== ERR_STORAGE_ROOT || !parts[1]) {
    return ["ERR+Release", "ERR+Release+Receipt"].includes(parts[0]) ? parts[0] : null;
  }
  if (parts[1] === "KSA" || parts[1] === "Kuwait") {
    if (!parts[2]) return null;
    if (parts.length >= 5 && !["quotations", "release-vouchers", "receipt-vouchers", "ERR+Release", "ERR+Release+Receipt"].includes(parts[3])) {
      return `${ERR_STORAGE_ROOT}/${parts[1]}/${parts[2]}/${parts[3]}`;
    }
    return `${ERR_STORAGE_ROOT}/${parts[1]}/${parts[2]}`;
  }
  return `${ERR_STORAGE_ROOT}/${parts[1]}`;
}












