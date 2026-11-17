-- Reference documents (optional extra document at a process step, visible only with documents.view_reference)
-- and a waiting period (delayHours) between a document's final approval and the upload of the next step.
ALTER TABLE "Document" ADD COLUMN "isReference" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ProcessStep" ADD COLUMN "referenceDocumentTypeId" TEXT;
ALTER TABLE "ProcessStep" ADD COLUMN "referenceDocumentSubtypeId" TEXT;
ALTER TABLE "ProcessStep" ADD COLUMN "delayHours" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProcessStep" ADD CONSTRAINT "ProcessStep_delay_chk" CHECK ("delayHours" >= 0 AND "delayHours" <= 8760);
ALTER TABLE "ProcessStep" ADD CONSTRAINT "ProcessStep_referenceDocumentTypeId_fkey" FOREIGN KEY ("referenceDocumentTypeId") REFERENCES "DocumentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcessStep" ADD CONSTRAINT "ProcessStep_referenceDocumentSubtypeId_fkey" FOREIGN KEY ("referenceDocumentSubtypeId") REFERENCES "DocumentSubtype"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProcessStepDocument" ADD COLUMN "referenceDocumentId" TEXT;
ALTER TABLE "ProcessStepDocument" ADD CONSTRAINT "ProcessStepDocument_referenceDocumentId_fkey" FOREIGN KEY ("referenceDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ProcessStepDocument_referenceDocumentId_idx" ON "ProcessStepDocument"("referenceDocumentId");

CREATE TABLE "ProcessUploadNotice" (
    "id" TEXT NOT NULL,
    "processInstanceId" TEXT NOT NULL,
    "processStepId" TEXT NOT NULL,
    "anchorDocumentId" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcessUploadNotice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProcessUploadNotice_processInstanceId_processStepId_anchorDocumentId_key"
  ON "ProcessUploadNotice"("processInstanceId", "processStepId", "anchorDocumentId");
ALTER TABLE "ProcessUploadNotice" ADD CONSTRAINT "ProcessUploadNotice_processInstanceId_fkey" FOREIGN KEY ("processInstanceId") REFERENCES "ProcessInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Permission" ("id", "code", "name", "description") VALUES
  (gen_random_uuid()::text, 'documents.view_reference', 'View reference documents', 'See reference documents attached to process steps, in scope. Without it they are hidden everywhere.')
ON CONFLICT ("code") DO NOTHING;
