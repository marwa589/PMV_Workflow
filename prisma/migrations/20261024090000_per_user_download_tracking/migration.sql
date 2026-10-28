-- Per-user download tracking: "Downloaded" / "Not Downloaded" is now stored per user and document.
CREATE TABLE "DocumentDownload" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "downloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentDownload_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentDownload_documentId_userId_key" ON "DocumentDownload"("documentId", "userId");
CREATE INDEX "DocumentDownload_userId_downloadedAt_idx" ON "DocumentDownload"("userId", "downloadedAt");

ALTER TABLE "DocumentDownload"
    ADD CONSTRAINT "DocumentDownload_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentDownload"
    ADD CONSTRAINT "DocumentDownload_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
