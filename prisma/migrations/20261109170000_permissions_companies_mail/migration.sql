-- 1. Users, roles & assignments and the mailing list are Admin-only screens now, and printing is not a permission.
--    Deleting a permission also removes it from every role.
DELETE FROM "Permission" WHERE "code" IN ('users.manage', 'assignments.manage', 'documents.print');

-- A deletion request notifies the people who may review it.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DELETION_REQUESTED';

-- 2. Process limits are removed from role assignments. An assignment limited to a process never granted anything
--    (no check ever passed a process), so those assignments are removed instead of suddenly granting more.
DELETE FROM "UserAssignment" ua
WHERE ua."processDefinitionId" IS NOT NULL
   OR EXISTS (SELECT 1 FROM "UserAssignmentProcessScope" s WHERE s."userAssignmentId" = ua."id");

DROP TABLE "UserAssignmentProcessScope";

DROP INDEX IF EXISTS "UserAssignment_userId_roleId_companyId_projectId_locationId_key";
ALTER TABLE "UserAssignment" DROP CONSTRAINT IF EXISTS "UserAssignment_processDefinitionId_fkey";
ALTER TABLE "UserAssignment" DROP COLUMN "processDefinitionId";
CREATE UNIQUE INDEX "UserAssignment_userId_roleId_companyId_projectId_locationId_key"
  ON "UserAssignment"("userId", "roleId", "companyId", "projectId", "locationId", "documentTypeId", "documentSubtypeId");

-- 3. A project may belong to a company; a role given for that company covers its projects.
ALTER TABLE "Project" ADD COLUMN "companyId" TEXT;
CREATE INDEX "Project_companyId_idx" ON "Project"("companyId");
ALTER TABLE "Project" ADD CONSTRAINT "Project_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Instant emails that fail are retried a few times, then dropped.
ALTER TABLE "EmailNotificationEvent" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
