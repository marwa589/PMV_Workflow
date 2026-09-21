-- Preserve existing file paths while recording the destination for new workflow saves.
ALTER TABLE "DocumentVersion" ADD COLUMN "storageFolder" TEXT;
ALTER TABLE "ErrFile" ADD COLUMN "storageFolder" TEXT;
