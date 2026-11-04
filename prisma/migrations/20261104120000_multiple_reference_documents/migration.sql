-- A step document can carry any number of reference documents: replaces the single ProcessStepDocument.referenceDocumentId.

-- CreateTable
CREATE TABLE "ProcessStepReference" (
    "id" TEXT NOT NULL,
    "processStepDocumentId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessStepReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessStepReference_processStepDocumentId_documentId_key" ON "ProcessStepReference"("processStepDocumentId", "documentId");
CREATE INDEX "ProcessStepReference_documentId_idx" ON "ProcessStepReference"("documentId");

-- AddForeignKey
ALTER TABLE "ProcessStepReference" ADD CONSTRAINT "ProcessStepReference_processStepDocumentId_fkey" FOREIGN KEY ("processStepDocumentId") REFERENCES "ProcessStepDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcessStepReference" ADD CONSTRAINT "ProcessStepReference_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep the reference documents that already exist.
INSERT INTO "ProcessStepReference" ("id", "processStepDocumentId", "documentId")
SELECT 'psr_' || md5(random()::text || "id"), "id", "referenceDocumentId"
FROM "ProcessStepDocument"
WHERE "referenceDocumentId" IS NOT NULL;

-- DropForeignKey / DropIndex / DropColumn
ALTER TABLE "ProcessStepDocument" DROP CONSTRAINT IF EXISTS "ProcessStepDocument_referenceDocumentId_fkey";
DROP INDEX IF EXISTS "ProcessStepDocument_referenceDocumentId_idx";
ALTER TABLE "ProcessStepDocument" DROP COLUMN "referenceDocumentId";
