-- One "pending tasks" email per person per hour: remembers when each person was last emailed and lets one worker
-- claim the send atomically.
CREATE TABLE "EmailDigestState" (
    "userId" TEXT NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "EmailDigestState_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "EmailDigestState" ADD CONSTRAINT "EmailDigestState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Emails that were queued under the old batching system are never sent by the digest: close them so nothing is left dangling.
UPDATE "EmailNotificationEvent" SET "emailSent" = true, "claimedAt" = NULL WHERE "emailSent" = false;
