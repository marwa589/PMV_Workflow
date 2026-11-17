-- Documents added to a process run that is already COMPLETED ("linked to the same group").
-- They sit next to the document that already fills the step, so they are exempt from the one-current-document-per-step rule.
ALTER TABLE "ProcessStepDocument" ADD COLUMN IF NOT EXISTS "isAddition" BOOLEAN NOT NULL DEFAULT false;

DROP INDEX IF EXISTS "ProcessStepDocument_one_current_key";
CREATE UNIQUE INDEX "ProcessStepDocument_one_current_key"
  ON "ProcessStepDocument" ("processInstanceId", "processStepId") WHERE "isCurrent" AND NOT "isAddition";
