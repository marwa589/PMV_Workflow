-- Unique tracks: a level of an approval flow (the uploader level included) can offer tracks that send the document
-- straight to one named person, and from there back to a later level or to full approval.

-- New states
ALTER TYPE "StepStatus" ADD VALUE IF NOT EXISTS 'SKIPPED';
ALTER TYPE "ApprovalActionType" ADD VALUE IF NOT EXISTS 'UNIQUE_TRACK';

-- Document steps created by a track
ALTER TABLE "DocumentApprovalStep" ADD COLUMN "isTrackStep" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DocumentApprovalStep" ADD COLUMN "originLevel" INTEGER;
ALTER TABLE "DocumentApprovalStep" ADD COLUMN "returnLevel" INTEGER;

-- Tracks of a flow level
CREATE TABLE "DocumentWorkflowTrack" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "receiverUserId" TEXT NOT NULL,
    "returnLevel" INTEGER,
    "signatureRequired" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentWorkflowTrack_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DocumentWorkflowTrack_stepId_idx" ON "DocumentWorkflowTrack"("stepId");
CREATE INDEX "DocumentWorkflowTrack_receiverUserId_idx" ON "DocumentWorkflowTrack"("receiverUserId");
ALTER TABLE "DocumentWorkflowTrack" ADD CONSTRAINT "DocumentWorkflowTrack_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "DocumentWorkflowStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentWorkflowTrack" ADD CONSTRAINT "DocumentWorkflowTrack_receiverUserId_fkey" FOREIGN KEY ("receiverUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The copy on each document
CREATE TABLE "DocumentApprovalTrack" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "receiverUserId" TEXT NOT NULL,
    "returnLevel" INTEGER,
    "signatureRequired" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentApprovalTrack_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DocumentApprovalTrack_stepId_idx" ON "DocumentApprovalTrack"("stepId");
CREATE INDEX "DocumentApprovalTrack_receiverUserId_idx" ON "DocumentApprovalTrack"("receiverUserId");
ALTER TABLE "DocumentApprovalTrack" ADD CONSTRAINT "DocumentApprovalTrack_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "DocumentApprovalStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentApprovalTrack" ADD CONSTRAINT "DocumentApprovalTrack_receiverUserId_fkey" FOREIGN KEY ("receiverUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
