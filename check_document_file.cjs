import "dotenv/config";
import { access } from "node:fs/promises";
import path from "node:path";
import { prisma } from "./src/lib/prisma";
import { resolveStoredFilePath } from "./src/lib/files";

async function main() {
  const id = "cmv3mx99t000lwsay5udic2lm";

  const document = await prisma.document.findUnique({
    where: { id },
    select: {
      id: true,
      documentNumber: true,
      currentVersion: true,
      versions: {
        select: {
          versionNumber: true,
          filePath: true,
          storageFolder: true,
          originalName: true,
          fileSize: true,
        },
      },
    },
  });

  if (!document) {
    console.log("Document record not found.");
    return;
  }

  console.log("Document:", document.documentNumber);
  console.log("Current version:", document.currentVersion);

  for (const version of document.versions) {
    const resolvedPath = resolveStoredFilePath(version.filePath);

    let exists = false;
    try {
      await access(resolvedPath);
      exists = true;
    } catch {
      // Report missing files without changing anything.
    }

    console.log({
      versionNumber: version.versionNumber,
      filePath: version.filePath,
      storageFolder: version.storageFolder,
      originalName: version.originalName,
      fileSize: version.fileSize,
      resolvedPath: path.resolve(resolvedPath),
      exists,
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });