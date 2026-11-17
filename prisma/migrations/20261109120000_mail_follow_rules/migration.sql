-- Follow-up mailing rules: email a person when a document of a chosen type is uploaded / approved in the same
-- process run as a document they uploaded or can open.
ALTER TYPE "EmailEventType" ADD VALUE IF NOT EXISTS 'PROCESS_DOCUMENT_UPLOADED';
ALTER TYPE "MailKind" ADD VALUE IF NOT EXISTS 'PROCESS_UPLOADED';
ALTER TYPE "MailKind" ADD VALUE IF NOT EXISTS 'PROCESS_APPROVED';

CREATE TYPE "MailFollowScope" AS ENUM ('OWN_UPLOADS', 'ACCESSIBLE');
CREATE TYPE "MailFollowEvent" AS ENUM ('UPLOADED', 'APPROVED');

CREATE TABLE "MailFollowRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" "MailFollowScope" NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "events" "MailFollowEvent"[],
    "delivery" "MailDelivery",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MailFollowRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MailFollowRule_userId_scope_documentTypeId_key" ON "MailFollowRule"("userId", "scope", "documentTypeId");
CREATE INDEX "MailFollowRule_documentTypeId_idx" ON "MailFollowRule"("documentTypeId");

ALTER TABLE "MailFollowRule" ADD CONSTRAINT "MailFollowRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MailFollowRule" ADD CONSTRAINT "MailFollowRule_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "DocumentType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
