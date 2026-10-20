CREATE TABLE "DocumentDownload" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "downloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentDownload_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ErrDownload" (
    "id" TEXT NOT NULL,
    "errId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "downloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrDownload_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentDownload_documentId_userId_key" ON "DocumentDownload"("documentId", "userId");
CREATE INDEX "DocumentDownload_userId_downloadedAt_idx" ON "DocumentDownload"("userId", "downloadedAt");
CREATE UNIQUE INDEX "ErrDownload_errId_userId_key" ON "ErrDownload"("errId", "userId");
CREATE INDEX "ErrDownload_userId_downloadedAt_idx" ON "ErrDownload"("userId", "downloadedAt");

ALTER TABLE "DocumentDownload"
    ADD CONSTRAINT "DocumentDownload_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentDownload"
    ADD CONSTRAINT "DocumentDownload_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ErrDownload"
    ADD CONSTRAINT "ErrDownload_errId_fkey"
    FOREIGN KEY ("errId") REFERENCES "Err"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ErrDownload"
    ADD CONSTRAINT "ErrDownload_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
