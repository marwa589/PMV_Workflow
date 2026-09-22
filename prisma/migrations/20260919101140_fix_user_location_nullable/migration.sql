-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "currentWorkflowStep" INTEGER,
ADD COLUMN     "documentSubtype" TEXT,
ADD COLUMN     "projectName" TEXT,
ADD COLUMN     "uploaderLocation" "UserLocation",
ADD COLUMN     "workflowTemplateId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "projectName" TEXT;

-- CreateTable
CREATE TABLE "DocumentWorkflowTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" "UserLocation",
    "documentType" "DocumentType" NOT NULL,
    "documentSubtype" TEXT,
    "projectName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentWorkflowTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentWorkflowStep" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "role" "UserRole" NOT NULL,
    "approverUserId" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentWorkflowStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentWorkflowTemplate_location_documentType_isActive_idx" ON "DocumentWorkflowTemplate"("location", "documentType", "isActive");

-- CreateIndex
CREATE INDEX "DocumentWorkflowTemplate_documentType_documentSubtype_isAct_idx" ON "DocumentWorkflowTemplate"("documentType", "documentSubtype", "isActive");

-- CreateIndex
CREATE INDEX "DocumentWorkflowTemplate_projectName_idx" ON "DocumentWorkflowTemplate"("projectName");

-- CreateIndex
CREATE INDEX "DocumentWorkflowStep_templateId_stepNumber_idx" ON "DocumentWorkflowStep"("templateId", "stepNumber");

-- CreateIndex
CREATE INDEX "DocumentWorkflowStep_approverUserId_idx" ON "DocumentWorkflowStep"("approverUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentWorkflowStep_templateId_stepNumber_key" ON "DocumentWorkflowStep"("templateId", "stepNumber");

-- CreateIndex
CREATE INDEX "Document_workflowTemplateId_idx" ON "Document"("workflowTemplateId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_workflowTemplateId_fkey" FOREIGN KEY ("workflowTemplateId") REFERENCES "DocumentWorkflowTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentWorkflowStep" ADD CONSTRAINT "DocumentWorkflowStep_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentWorkflowTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentWorkflowStep" ADD CONSTRAINT "DocumentWorkflowStep_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
