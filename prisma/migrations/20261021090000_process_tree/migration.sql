-- Process trees: a process is now a tree of document nodes instead of a linear list of steps.

-- AlterTable
ALTER TABLE "ProcessStep" ADD COLUMN "parentStepId" TEXT;

-- AlterTable
ALTER TABLE "ProcessInstance" ADD COLUMN "currentStepId" TEXT;

-- CreateIndex
CREATE INDEX "ProcessStep_parentStepId_idx" ON "ProcessStep"("parentStepId");

-- CreateIndex
CREATE INDEX "ProcessInstance_currentStepId_idx" ON "ProcessInstance"("currentStepId");

-- AddForeignKey
ALTER TABLE "ProcessStep" ADD CONSTRAINT "ProcessStep_parentStepId_fkey" FOREIGN KEY ("parentStepId") REFERENCES "ProcessStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessInstance" ADD CONSTRAINT "ProcessInstance_currentStepId_fkey" FOREIGN KEY ("currentStepId") REFERENCES "ProcessStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A tree can have more nodes than the old 10-step list (stepNumber is now just a unique label per node).
ALTER TABLE "ProcessStep" DROP CONSTRAINT IF EXISTS "ProcessStep_step_chk";
ALTER TABLE "ProcessStep" ADD CONSTRAINT "ProcessStep_step_chk" CHECK ("stepNumber" BETWEEN 1 AND 100);

-- Start fresh: the old linear processes have no root/child links, so they cannot run as trees.
-- They stay in the database as history (inactive), and any run still in progress is closed.
UPDATE "ProcessInstance" SET "status" = 'CANCELLED', "completedAt" = NOW() WHERE "status" = 'IN_PROGRESS';
UPDATE "ProcessDefinition" SET "isActive" = false;
