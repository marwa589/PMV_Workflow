import { prisma } from "./src/lib/prisma";
import { resolveStoredFilePath } from "./src/lib/files";
import { access } from "node:fs/promises";

async function main() {
  const id = "cmv3mx99t000lwsay5udic2lm";

  const document = await prisma.document.findUnique({
    where: { id },
    select: {
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
    } catch {}

    console.log({
      ...version,
      resolvedPath,
      exists,
    });
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
