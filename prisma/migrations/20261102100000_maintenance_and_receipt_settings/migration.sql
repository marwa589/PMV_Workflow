ALTER TABLE "DocumentType" ADD COLUMN "receiptConfirmationRequired" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "DocumentSubtype" ADD COLUMN "receiptConfirmationRequired" BOOLEAN;

CREATE TYPE "MaintenanceRequestType" AS ENUM ('REPAIR', 'NEW_INSTALLATION');
CREATE TYPE "MaintenanceTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'CLOSED');

CREATE TABLE "MaintenanceItem" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaintenanceItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MaintenanceItem_name_key" ON "MaintenanceItem"("name");

CREATE TABLE "MaintenanceWorkflow" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaintenanceWorkflow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MaintenanceWorkflow_name_key" ON "MaintenanceWorkflow"("name");

CREATE TABLE "MaintenanceWorkflowLevel" (
  "id" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "levelNumber" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaintenanceWorkflowLevel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MaintenanceWorkflowLevel_workflowId_levelNumber_key" ON "MaintenanceWorkflowLevel"("workflowId", "levelNumber");
CREATE INDEX "MaintenanceWorkflowLevel_workflowId_levelNumber_idx" ON "MaintenanceWorkflowLevel"("workflowId", "levelNumber");

CREATE TABLE "MaintenanceWorkflowStepApprover" (
  "id" TEXT NOT NULL,
  "levelId" TEXT NOT NULL,
  "approverType" "ApproverType" NOT NULL,
  "userId" TEXT,
  "userTypeId" TEXT,
  CONSTRAINT "MaintenanceWorkflowStepApprover_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MaintenanceWorkflowStepApprover_levelId_idx" ON "MaintenanceWorkflowStepApprover"("levelId");
CREATE INDEX "MaintenanceWorkflowStepApprover_userId_idx" ON "MaintenanceWorkflowStepApprover"("userId");
CREATE INDEX "MaintenanceWorkflowStepApprover_userTypeId_idx" ON "MaintenanceWorkflowStepApprover"("userTypeId");

CREATE TABLE "MaintenanceWorkflowAssignment" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaintenanceWorkflowAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MaintenanceWorkflowAssignment_projectId_itemId_key" ON "MaintenanceWorkflowAssignment"("projectId", "itemId");
CREATE INDEX "MaintenanceWorkflowAssignment_workflowId_idx" ON "MaintenanceWorkflowAssignment"("workflowId");

CREATE TABLE "MaintenanceTicket" (
  "id" TEXT NOT NULL,
  "ticketNumber" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "requestType" "MaintenanceRequestType" NOT NULL,
  "units" INTEGER NOT NULL,
  "phoneNumber" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" "MaintenanceTicketStatus" NOT NULL DEFAULT 'OPEN',
  "currentLevel" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "MaintenanceTicket_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MaintenanceTicket_ticketNumber_key" ON "MaintenanceTicket"("ticketNumber");
CREATE INDEX "MaintenanceTicket_requesterId_createdAt_idx" ON "MaintenanceTicket"("requesterId", "createdAt");
CREATE INDEX "MaintenanceTicket_projectId_status_idx" ON "MaintenanceTicket"("projectId", "status");
CREATE INDEX "MaintenanceTicket_status_currentLevel_idx" ON "MaintenanceTicket"("status", "currentLevel");

CREATE TABLE "MaintenanceTicketLevel" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "levelNumber" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "actedById" TEXT,
  "actedAt" TIMESTAMP(3),
  CONSTRAINT "MaintenanceTicketLevel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MaintenanceTicketLevel_ticketId_levelNumber_key" ON "MaintenanceTicketLevel"("ticketId", "levelNumber");

CREATE TABLE "MaintenanceTicketLevelApprover" (
  "id" TEXT NOT NULL,
  "levelId" TEXT NOT NULL,
  "approverType" "ApproverType" NOT NULL,
  "userId" TEXT,
  "userTypeId" TEXT,
  CONSTRAINT "MaintenanceTicketLevelApprover_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MaintenanceTicketLevelApprover_levelId_idx" ON "MaintenanceTicketLevelApprover"("levelId");
CREATE INDEX "MaintenanceTicketLevelApprover_userId_idx" ON "MaintenanceTicketLevelApprover"("userId");
CREATE INDEX "MaintenanceTicketLevelApprover_userTypeId_idx" ON "MaintenanceTicketLevelApprover"("userTypeId");

CREATE TABLE "MaintenanceTicketEvent" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "levelNumber" INTEGER,
  "action" TEXT NOT NULL,
  "details" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaintenanceTicketEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MaintenanceTicketEvent_ticketId_createdAt_idx" ON "MaintenanceTicketEvent"("ticketId", "createdAt");

CREATE TABLE "MaintenanceTicketAttachment" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaintenanceTicketAttachment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MaintenanceTicketAttachment_ticketId_createdAt_idx" ON "MaintenanceTicketAttachment"("ticketId", "createdAt");

ALTER TABLE "MaintenanceWorkflowLevel" ADD CONSTRAINT "MaintenanceWorkflowLevel_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "MaintenanceWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceWorkflowStepApprover" ADD CONSTRAINT "MaintenanceWorkflowStepApprover_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "MaintenanceWorkflowLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceWorkflowStepApprover" ADD CONSTRAINT "MaintenanceWorkflowStepApprover_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceWorkflowStepApprover" ADD CONSTRAINT "MaintenanceWorkflowStepApprover_userTypeId_fkey" FOREIGN KEY ("userTypeId") REFERENCES "UserType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceWorkflowAssignment" ADD CONSTRAINT "MaintenanceWorkflowAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceWorkflowAssignment" ADD CONSTRAINT "MaintenanceWorkflowAssignment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MaintenanceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceWorkflowAssignment" ADD CONSTRAINT "MaintenanceWorkflowAssignment_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "MaintenanceWorkflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceTicket" ADD CONSTRAINT "MaintenanceTicket_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceTicket" ADD CONSTRAINT "MaintenanceTicket_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MaintenanceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceTicket" ADD CONSTRAINT "MaintenanceTicket_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceTicket" ADD CONSTRAINT "MaintenanceTicket_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "MaintenanceWorkflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceTicketLevel" ADD CONSTRAINT "MaintenanceTicketLevel_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "MaintenanceTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceTicketLevel" ADD CONSTRAINT "MaintenanceTicketLevel_actedById_fkey" FOREIGN KEY ("actedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MaintenanceTicketLevelApprover" ADD CONSTRAINT "MaintenanceTicketLevelApprover_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "MaintenanceTicketLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceTicketLevelApprover" ADD CONSTRAINT "MaintenanceTicketLevelApprover_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceTicketLevelApprover" ADD CONSTRAINT "MaintenanceTicketLevelApprover_userTypeId_fkey" FOREIGN KEY ("userTypeId") REFERENCES "UserType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceTicketEvent" ADD CONSTRAINT "MaintenanceTicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "MaintenanceTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceTicketEvent" ADD CONSTRAINT "MaintenanceTicketEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceTicketAttachment" ADD CONSTRAINT "MaintenanceTicketAttachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "MaintenanceTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceTicketAttachment" ADD CONSTRAINT "MaintenanceTicketAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
