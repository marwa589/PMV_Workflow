-- AlterTable: Replace projectName with projectId and relation to ErrProject
ALTER TABLE "ErrUserAccess" ADD COLUMN IF NOT EXISTS "projectId" TEXT;

-- DropIndex / DropConstraint
ALTER TABLE "ErrUserAccess" DROP CONSTRAINT IF EXISTS "ErrUserAccess_userId_role_key";
DROP INDEX IF EXISTS "ErrUserAccess_userId_role_key";

-- Drop deprecated column projectName if exists
ALTER TABLE "ErrUserAccess" DROP COLUMN IF EXISTS "projectName";

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ErrUserAccess_projectId_fkey'
  ) THEN
    ALTER TABLE "ErrUserAccess"
    ADD CONSTRAINT "ErrUserAccess_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "ErrProject"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- CreateIndex: @@unique([userId, role, projectId])
CREATE UNIQUE INDEX IF NOT EXISTS "ErrUserAccess_userId_role_projectId_key" ON "ErrUserAccess"("userId", "role", "projectId");

-- CreateIndex: Unique partial index for global roles with no projectId
CREATE UNIQUE INDEX IF NOT EXISTS "ErrUserAccess_userId_role_global_key" ON "ErrUserAccess"("userId", "role") WHERE "projectId" IS NULL;

-- CreateIndex: projectId + isActive index
CREATE INDEX IF NOT EXISTS "ErrUserAccess_projectId_isActive_idx" ON "ErrUserAccess"("projectId", "isActive");
