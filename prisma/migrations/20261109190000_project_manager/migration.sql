-- Project manager: like the project director, each project can name one user as its manager, and a flow level can be
-- set to "Project Manager".
ALTER TYPE "ApproverType" ADD VALUE IF NOT EXISTS 'PROJECT_MANAGER';

ALTER TABLE "Project" ADD COLUMN "managerId" TEXT;
CREATE INDEX "Project_managerId_idx" ON "Project"("managerId");
ALTER TABLE "Project" ADD CONSTRAINT "Project_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Document levels copied from a "Project Manager" entry remember it, so a change of manager can follow through.
ALTER TABLE "DocumentApprovalStepApprover" ADD COLUMN "viaProjectManager" BOOLEAN NOT NULL DEFAULT false;
