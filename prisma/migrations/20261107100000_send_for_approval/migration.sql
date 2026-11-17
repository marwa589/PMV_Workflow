-- "Send for approval": a reviewer (Admin, or anyone holding the permission) can send a document at their level to one
-- chosen user. When that user approves, the document comes back to the sender.

-- New history action
ALTER TYPE "ApprovalActionType" ADD VALUE IF NOT EXISTS 'SENT_FOR_APPROVAL';

-- Steps created by "Send for approval" and who sent them
ALTER TABLE "DocumentApprovalStep" ADD COLUMN "isSideApproval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DocumentApprovalStep" ADD COLUMN "sentById" TEXT;
CREATE INDEX "DocumentApprovalStep_sentById_idx" ON "DocumentApprovalStep"("sentById");
ALTER TABLE "DocumentApprovalStep" ADD CONSTRAINT "DocumentApprovalStep_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- New permission
INSERT INTO "Permission" ("id", "code", "name", "description")
SELECT 'perm_' || md5(random()::text), 'documents.send_for_approval', 'Send for approval',
  'Adds "Send for approval" to the review decisions of documents inside the scope: pick any user to approve the document first, then it comes back to the sender. Admin users always have it.'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'documents.send_for_approval');
