CREATE TABLE "UserAssignmentProjectScope" (
    "userAssignmentId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    CONSTRAINT "UserAssignmentProjectScope_pkey" PRIMARY KEY ("userAssignmentId", "projectId")
);

CREATE TABLE "UserAssignmentDocumentTypeScope" (
    "userAssignmentId" TEXT NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "allSubtypes" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "UserAssignmentDocumentTypeScope_pkey" PRIMARY KEY ("userAssignmentId", "documentTypeId")
);

CREATE TABLE "UserAssignmentDocumentSubtypeScope" (
    "userAssignmentId" TEXT NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "documentSubtypeId" TEXT NOT NULL,
    CONSTRAINT "UserAssignmentDocumentSubtypeScope_pkey" PRIMARY KEY ("userAssignmentId", "documentTypeId", "documentSubtypeId")
);

CREATE TABLE "UserAssignmentProcessScope" (
    "userAssignmentId" TEXT NOT NULL,
    "processDefinitionId" TEXT NOT NULL,
    CONSTRAINT "UserAssignmentProcessScope_pkey" PRIMARY KEY ("userAssignmentId", "processDefinitionId")
);

INSERT INTO "UserAssignmentProjectScope" ("userAssignmentId", "projectId")
SELECT "id", "projectId" FROM "UserAssignment" WHERE "projectId" IS NOT NULL;

INSERT INTO "UserAssignmentDocumentTypeScope" ("userAssignmentId", "documentTypeId", "allSubtypes")
SELECT "id", "documentTypeId", "documentSubtypeId" IS NULL
FROM "UserAssignment" WHERE "documentTypeId" IS NOT NULL;

INSERT INTO "UserAssignmentDocumentSubtypeScope" ("userAssignmentId", "documentTypeId", "documentSubtypeId")
SELECT "id", "documentTypeId", "documentSubtypeId"
FROM "UserAssignment"
WHERE "documentTypeId" IS NOT NULL AND "documentSubtypeId" IS NOT NULL;

INSERT INTO "UserAssignmentProcessScope" ("userAssignmentId", "processDefinitionId")
SELECT "id", "processDefinitionId" FROM "UserAssignment" WHERE "processDefinitionId" IS NOT NULL;

CREATE INDEX "UserAssignmentProjectScope_projectId_idx" ON "UserAssignmentProjectScope"("projectId");
CREATE INDEX "UserAssignmentDocumentTypeScope_documentTypeId_idx" ON "UserAssignmentDocumentTypeScope"("documentTypeId");
CREATE INDEX "UserAssignmentDocumentSubtypeScope_documentSubtypeId_idx" ON "UserAssignmentDocumentSubtypeScope"("documentSubtypeId");
CREATE INDEX "UserAssignmentProcessScope_processDefinitionId_idx" ON "UserAssignmentProcessScope"("processDefinitionId");

ALTER TABLE "UserAssignmentProjectScope"
ADD CONSTRAINT "UserAssignmentProjectScope_userAssignmentId_fkey"
FOREIGN KEY ("userAssignmentId") REFERENCES "UserAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserAssignmentProjectScope"
ADD CONSTRAINT "UserAssignmentProjectScope_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserAssignmentDocumentTypeScope"
ADD CONSTRAINT "UserAssignmentDocumentTypeScope_userAssignmentId_fkey"
FOREIGN KEY ("userAssignmentId") REFERENCES "UserAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserAssignmentDocumentTypeScope"
ADD CONSTRAINT "UserAssignmentDocumentTypeScope_documentTypeId_fkey"
FOREIGN KEY ("documentTypeId") REFERENCES "DocumentType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserAssignmentDocumentSubtypeScope"
ADD CONSTRAINT "UserAssignmentDocumentSubtypeScope_userAssignmentId_documentTypeId_fkey"
FOREIGN KEY ("userAssignmentId", "documentTypeId")
REFERENCES "UserAssignmentDocumentTypeScope"("userAssignmentId", "documentTypeId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserAssignmentDocumentSubtypeScope"
ADD CONSTRAINT "UserAssignmentDocumentSubtypeScope_documentSubtypeId_fkey"
FOREIGN KEY ("documentSubtypeId") REFERENCES "DocumentSubtype"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserAssignmentProcessScope"
ADD CONSTRAINT "UserAssignmentProcessScope_userAssignmentId_fkey"
FOREIGN KEY ("userAssignmentId") REFERENCES "UserAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserAssignmentProcessScope"
ADD CONSTRAINT "UserAssignmentProcessScope_processDefinitionId_fkey"
FOREIGN KEY ("processDefinitionId") REFERENCES "ProcessDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
