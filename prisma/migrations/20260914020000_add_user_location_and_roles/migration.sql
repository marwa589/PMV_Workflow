CREATE TYPE "UserLocation" AS ENUM ('AVR', 'AVK', 'KUWAIT');

ALTER TABLE "User"
  ADD COLUMN "location" "UserLocation";

CREATE TABLE "UserRoleAssignment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserRoleAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserRoleAssignment_userId_role_key"
  ON "UserRoleAssignment"("userId", "role");

CREATE INDEX "UserRoleAssignment_userId_role_idx"
  ON "UserRoleAssignment"("userId", "role");

ALTER TABLE "UserRoleAssignment"
  ADD CONSTRAINT "UserRoleAssignment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
