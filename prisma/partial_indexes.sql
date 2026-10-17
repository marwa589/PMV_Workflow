-- Constraints Prisma cannot express. Append to the END of the generated init migration.sql
-- (works on any PostgreSQL version; COALESCE makes NULL scope columns count as "equal").
-- NOTE: do not use `prisma db push` once these exist; it would drop them. Use `prisma migrate`.

-- One flow-assignment row per (type, sub type, project); NULL means "all".
CREATE UNIQUE INDEX "DocumentWorkflowAssignment_scope_key"
  ON "DocumentWorkflowAssignment" ("documentTypeId", COALESCE("documentSubtypeId", ''), COALESCE("projectId", ''));

-- One assignment per user + role + scope.
CREATE UNIQUE INDEX "UserAssignment_scope_key"
  ON "UserAssignment" ("userId", "roleId", COALESCE("companyId", ''), COALESCE("projectId", ''),
    COALESCE("locationId", ''), COALESCE("documentTypeId", ''), COALESCE("documentSubtypeId", ''),
    COALESCE("processDefinitionId", ''));

-- One counter per type + subtype + project + year. Subtyped document numbers leave project empty.
CREATE UNIQUE INDEX "DocumentNumberCounter_scope_key"
  ON "DocumentNumberCounter" ("documentTypeId", COALESCE("documentSubtypeId", ''),
    COALESCE("projectId", ''), "periodYear");

-- One value per document + field + line (line empty for header fields).
CREATE UNIQUE INDEX "DocumentFieldValue_scope_key"
  ON "DocumentFieldValue" ("documentId", "fieldDefinitionId", COALESCE("lineItemId", ''));

-- field_key unique within type + sub type + group.
CREATE UNIQUE INDEX "FieldDefinition_scope_key"
  ON "FieldDefinition" ("documentTypeId", COALESCE("documentSubtypeId", ''), "fieldGroup", "fieldKey");

-- Only one current document per step in a process run.
CREATE UNIQUE INDEX "ProcessStepDocument_one_current_key"
  ON "ProcessStepDocument" ("processInstanceId", "processStepId") WHERE "isCurrent";

-- An approver entry is either a named user or a user type, never both or neither.
ALTER TABLE "DocumentWorkflowStepApprover" ADD CONSTRAINT "DocumentWorkflowStepApprover_kind_chk"
  CHECK (("approverType" = 'USER' AND "userId" IS NOT NULL AND "userTypeId" IS NULL)
      OR ("approverType" = 'USER_TYPE' AND "userTypeId" IS NOT NULL AND "userId" IS NULL));
ALTER TABLE "DocumentApprovalStepApprover" ADD CONSTRAINT "DocumentApprovalStepApprover_kind_chk"
  CHECK (("approverType" = 'USER' AND "userId" IS NOT NULL AND "userTypeId" IS NULL)
      OR ("approverType" = 'USER_TYPE' AND "userTypeId" IS NOT NULL AND "userId" IS NULL));

-- Level / step ranges from the PDF: level 0 = uploader, 1 to 10 = approvals; process steps 1 to 10.
ALTER TABLE "DocumentWorkflowStep" ADD CONSTRAINT "DocumentWorkflowStep_level_chk" CHECK ("stepNumber" BETWEEN 0 AND 10);
ALTER TABLE "DocumentApprovalStep" ADD CONSTRAINT "DocumentApprovalStep_level_chk" CHECK ("levelNumber" BETWEEN 0 AND 10);
ALTER TABLE "ProcessStep" ADD CONSTRAINT "ProcessStep_step_chk" CHECK ("stepNumber" BETWEEN 1 AND 10);

-- A delegation must hand tasks to a different user.
ALTER TABLE "ApprovalDelegation" ADD CONSTRAINT "ApprovalDelegation_distinct_chk" CHECK ("delegatorUserId" <> "delegateUserId");
