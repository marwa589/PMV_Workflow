-- "Signature required" is now a setting of each approval flow level (on by default) instead of a permission.
ALTER TABLE "DocumentWorkflowStep" ADD COLUMN "signatureRequired" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "DocumentApprovalStep" ADD COLUMN "signatureRequired" BOOLEAN NOT NULL DEFAULT true;

-- The old permission no longer does anything. Removing it also removes it from every role.
DELETE FROM "Permission" WHERE "code" = 'documents.approve_without_signature';
