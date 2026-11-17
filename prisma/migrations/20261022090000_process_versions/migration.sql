-- Editing a process that has runs creates a new version of its tree; existing runs keep their version.
ALTER TABLE "ProcessDefinition" ADD COLUMN "currentVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ProcessStep" ADD COLUMN "versionNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ProcessInstance" ADD COLUMN "stepVersion" INTEGER NOT NULL DEFAULT 1;

DROP INDEX "ProcessStep_processDefinitionId_stepNumber_key";
CREATE UNIQUE INDEX "ProcessStep_processDefinitionId_versionNumber_stepNumber_key" ON "ProcessStep"("processDefinitionId", "versionNumber", "stepNumber");
