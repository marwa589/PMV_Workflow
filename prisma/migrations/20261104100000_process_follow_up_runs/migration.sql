-- Follow-up runs: several documents uploaded together as the next step of a run each become their own run,
-- linked to the run (and the approved document) they follow.

-- AlterTable
ALTER TABLE "ProcessInstance" ADD COLUMN "parentInstanceId" TEXT;
ALTER TABLE "ProcessInstance" ADD COLUMN "followedDocumentId" TEXT;

-- CreateIndex
CREATE INDEX "ProcessInstance_parentInstanceId_idx" ON "ProcessInstance"("parentInstanceId");
CREATE INDEX "ProcessInstance_followedDocumentId_idx" ON "ProcessInstance"("followedDocumentId");

-- AddForeignKey
ALTER TABLE "ProcessInstance" ADD CONSTRAINT "ProcessInstance_parentInstanceId_fkey" FOREIGN KEY ("parentInstanceId") REFERENCES "ProcessInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProcessInstance" ADD CONSTRAINT "ProcessInstance_followedDocumentId_fkey" FOREIGN KEY ("followedDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
