-- Mailing list managed on its own page (no longer through roles and permissions).
-- After deploying, run:  node prisma/migrate-mailing-list.mjs --apply
-- It copies today's "Receive mail" role assignments into MailSetting rows and then removes those permissions.

CREATE TYPE "MailKind" AS ENUM ('AWAITING_REVIEW', 'AWAITING_UPLOAD', 'OWN_APPROVED', 'OWN_REJECTED', 'OWN_REVISION', 'WATCH_APPROVED', 'WATCH_REJECTED', 'WATCH_REVISION');
CREATE TYPE "MailDelivery" AS ENUM ('OFF', 'DIGEST', 'INSTANT');

CREATE TABLE "MailKindDefault" (
    "kind" "MailKind" NOT NULL,
    "delivery" "MailDelivery" NOT NULL,

    CONSTRAINT "MailKindDefault_pkey" PRIMARY KEY ("kind")
);

CREATE TABLE "MailSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "MailKind" NOT NULL,
    "delivery" "MailDelivery",
    "projectIds" TEXT[],
    "documentTypeIds" TEXT[],
    "documentSubtypeIds" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MailSetting_userId_kind_key" ON "MailSetting"("userId", "kind");
CREATE INDEX "MailSetting_kind_idx" ON "MailSetting"("kind");
ALTER TABLE "MailSetting" ADD CONSTRAINT "MailSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailNotificationEvent" ADD COLUMN "kind" "MailKind";
ALTER TABLE "EmailNotificationEvent" ADD COLUMN "instant" BOOLEAN NOT NULL DEFAULT false;

-- Defaults reproduce today's behaviour: pending tasks in the hourly summary, no result emails.
-- The "watch" kinds only apply to people who were added to them, so the hourly summary is their default.
INSERT INTO "MailKindDefault" ("kind", "delivery") VALUES
  ('AWAITING_REVIEW', 'DIGEST'),
  ('AWAITING_UPLOAD', 'DIGEST'),
  ('OWN_APPROVED', 'OFF'),
  ('OWN_REJECTED', 'OFF'),
  ('OWN_REVISION', 'OFF'),
  ('WATCH_APPROVED', 'DIGEST'),
  ('WATCH_REJECTED', 'DIGEST'),
  ('WATCH_REVISION', 'DIGEST');

-- The "Receive mail" permissions are replaced by the Mailing List page. Drop them when nobody holds them (fresh installs);
-- where assignments still use them they stay until prisma/migrate-mailing-list.mjs --apply has copied them over.
DELETE FROM "Permission"
WHERE "code" IN ('mail.receive_approved', 'mail.receive_rejected', 'mail.receive_revision')
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp
    JOIN "UserAssignment" ua ON ua."roleId" = rp."roleId"
    WHERE rp."permissionId" = "Permission"."id"
  );
