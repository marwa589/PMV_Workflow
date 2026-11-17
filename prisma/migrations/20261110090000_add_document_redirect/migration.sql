-- Marc's "Redirect document" decision: the document is handed to another user, and the
-- fallback says what happens when that user approves (fully approve, or back to Marc).
ALTER TYPE "ApprovalActionType" ADD VALUE IF NOT EXISTS 'REDIRECTED';

CREATE TYPE "RedirectFallback" AS ENUM ('FULLY_APPROVE', 'BACK_TO_REDIRECTOR');

ALTER TABLE "Document"
    ADD COLUMN "redirectedById" TEXT,
    ADD COLUMN "redirectFallback" "RedirectFallback";

CREATE INDEX "Document_redirectedById_idx" ON "Document"("redirectedById");

ALTER TABLE "Document"
    ADD CONSTRAINT "Document_redirectedById_fkey"
    FOREIGN KEY ("redirectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
