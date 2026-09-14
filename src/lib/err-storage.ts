import "server-only";

// Encode characters Windows cannot use while keeping ordinary names readable.
export function projectStorageFolder(projectName: string): string {
  const name = projectName.trim();

  if (!name) {
    throw new Error("The selected project has no name.");
  }

  let folder = name
    .replace(/[%<>:"/\\|?*\u0000-\u001f]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`
    )
    .replace(/[. ]+$/g, (ending) =>
      Array.from(ending, (character) =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`
      ).join("")
    );

  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(folder)) {
    folder =
      `%${folder.charCodeAt(0).toString(16).toUpperCase()}` +
      folder.slice(1);
  }

  return `ERRs/${folder}`;
}

// Pass only an ERR_PDF file path here.
// Old layout returns null; new layout returns ERRs/Project Name.
export function projectStorageFolderFromFile(
  filePath?: string | null,
): string | null {
  if (!filePath) return null;

  const parts = filePath.replaceAll("\\", "/").split("/");

  if (parts[0] !== "ERRs" || !parts[1]) return null;

  if (parts.length === 3) {
    return `ERRs/${parts[1]}`;
  }

  if (
    parts.length === 4 &&
    ["ERR+Release", "ERR+Release+Receipt"].includes(parts[2])
  ) {
    return `ERRs/${parts[1]}`;
  }

  return null;
}