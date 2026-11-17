-- Project director: each project can name one user as its director, and a flow level can be set to "Project Director".
ALTER TYPE "ApproverType" ADD VALUE IF NOT EXISTS 'PROJECT_DIRECTOR';

ALTER TABLE "Project" ADD COLUMN "directorId" TEXT;
CREATE INDEX "Project_directorId_idx" ON "Project"("directorId");
ALTER TABLE "Project" ADD CONSTRAINT "Project_directorId_fkey" FOREIGN KEY ("directorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Document levels copied from a "Project Director" entry remember it, so a change of director can follow through.
ALTER TABLE "DocumentApprovalStepApprover" ADD COLUMN "viaProjectDirector" BOOLEAN NOT NULL DEFAULT false;
