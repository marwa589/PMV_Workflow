-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'REVISION_REQUIRED', 'ON_HOLD', 'APPROVED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('WAITING', 'PENDING', 'APPROVED', 'REJECTED', 'REVISION', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "ApproverType" AS ENUM ('USER', 'USER_TYPE');

-- CreateEnum
CREATE TYPE "ApprovalActionType" AS ENUM ('SUBMITTED', 'APPROVED', 'AUTO_APPROVED', 'DELEGATED_APPROVED', 'REJECTED', 'REQUESTED_REVISION', 'PUT_ON_HOLD', 'RESUMED', 'RESUBMITTED', 'COMMENTED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DeletionRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FieldGroup" AS ENUM ('HEADER', 'LINE_ITEM');

-- CreateEnum
CREATE TYPE "FieldDataType" AS ENUM ('TEXT', 'LONG_TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT', 'MULTI_SELECT');

-- CreateEnum
CREATE TYPE "ProcessStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProcessStepSource" AS ENUM ('EXISTING', 'UPLOADED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('PENDING_APPROVAL', 'DOCUMENT_APPROVED', 'DOCUMENT_REJECTED', 'DOCUMENT_REVISED', 'DOCUMENT_DELETED', 'DOCUMENT_ON_HOLD', 'DOCUMENT_RESUMED');

-- CreateEnum
CREATE TYPE "EmailEventType" AS ENUM ('APPROVAL_PENDING', 'WORKFLOW_APPROVED', 'WORKFLOW_REJECTED', 'APPROVAL_OVERDUE', 'PROCESS_STEP_OVERDUE');

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "userTypeId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "signatureFileSize" INTEGER,
    "signatureMimeType" TEXT,
    "signatureOriginalName" TEXT,
    "signaturePath" TEXT,
    "signatureUpdatedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "namingPattern" TEXT NOT NULL DEFAULT '{TYPE}-{PROJECT}-{YYYY}-{SEQ:4}',
    "supportsLineItems" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSubtype" (
    "id" TEXT NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentSubtype_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldDefinition" (
    "id" TEXT NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "documentSubtypeId" TEXT,
    "fieldGroup" "FieldGroup" NOT NULL DEFAULT 'HEADER',
    "fieldKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "dataType" "FieldDataType" NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentNumberCounter" (
    "id" TEXT NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "projectId" TEXT,
    "periodYear" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentNumberCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "UserAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "companyId" TEXT,
    "projectId" TEXT,
    "locationId" TEXT,
    "documentTypeId" TEXT,
    "documentSubtypeId" TEXT,
    "processDefinitionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalDelegation" (
    "id" TEXT NOT NULL,
    "delegatorUserId" TEXT NOT NULL,
    "delegateUserId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDelegation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentWorkflowTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentWorkflowTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentWorkflowStep" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentWorkflowStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentWorkflowStepApprover" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "approverType" "ApproverType" NOT NULL,
    "userTypeId" TEXT,
    "userId" TEXT,

    CONSTRAINT "DocumentWorkflowStepApprover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentWorkflowAssignment" (
    "id" TEXT NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "documentSubtypeId" TEXT,
    "projectId" TEXT,
    "templateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentWorkflowAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "submissionKey" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,
    "lockVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "documentSubtypeId" TEXT,
    "projectId" TEXT,
    "workflowTemplateId" TEXT,
    "currentWorkflowStep" INTEGER,
    "currentApproverAssignedAt" TIMESTAMP(3),
    "downloadedAt" TIMESTAMP(3),
    "lastActiveStage" "DocumentStatus",
    "receivedAt" TIMESTAMP(3),
    "receivedById" TEXT,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentLineItem" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,

    CONSTRAINT "DocumentLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentFieldValue" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "fieldDefinitionId" TEXT NOT NULL,
    "lineItemId" TEXT,
    "valueText" TEXT,
    "valueNumber" DECIMAL(65,30),
    "valueDate" DATE,
    "valueBoolean" BOOLEAN,
    "valueJson" JSONB,

    CONSTRAINT "DocumentFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,
    "filePath" TEXT NOT NULL,
    "storageFolder" TEXT,
    "originalName" TEXT NOT NULL,
    "extension" TEXT,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT NOT NULL,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessStep" (
    "id" TEXT NOT NULL,
    "processDefinitionId" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "documentSubtypeId" TEXT,

    CONSTRAINT "ProcessStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessInstance" (
    "id" TEXT NOT NULL,
    "processDefinitionId" TEXT NOT NULL,
    "projectId" TEXT,
    "reference" TEXT,
    "status" "ProcessStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "currentStepNumber" INTEGER NOT NULL DEFAULT 1,
    "startedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ProcessInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessStepDocument" (
    "id" TEXT NOT NULL,
    "processInstanceId" TEXT NOT NULL,
    "processStepId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "source" "ProcessStepSource" NOT NULL,
    "linkedById" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessStepDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentApprovalStep" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "levelNumber" INTEGER NOT NULL,
    "name" TEXT,
    "status" "StepStatus" NOT NULL DEFAULT 'WAITING',
    "actedById" TEXT,
    "actedAt" TIMESTAMP(3),
    "comment" TEXT,

    CONSTRAINT "DocumentApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentApprovalStepApprover" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "approverType" "ApproverType" NOT NULL,
    "userTypeId" TEXT,
    "userId" TEXT,

    CONSTRAINT "DocumentApprovalStepApprover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalHistory" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "action" "ApprovalActionType" NOT NULL,
    "comments" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "performedById" TEXT NOT NULL,
    "versionId" TEXT,
    "outputVersionId" TEXT,
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,
    "levelNumber" INTEGER,
    "fromStatus" "DocumentStatus",
    "toStatus" "DocumentStatus",
    "revisionTargetLevel" INTEGER,
    "onBehalfOfUserId" TEXT,

    CONSTRAINT "ApprovalHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletionRequest" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approverId" TEXT,
    "status" "DeletionRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "adminReviewerId" TEXT,

    CONSTRAINT "DeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "documentId" TEXT,
    "eventKey" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailNotificationEvent" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "type" "EmailEventType" NOT NULL,
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailDueAt" TIMESTAMP(3) NOT NULL,
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "EmailNotificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "documentId" TEXT,
    "performedById" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "TrustedDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "challengeTokenHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Location_name_key" ON "Location"("name");

-- CreateIndex
CREATE INDEX "Company_locationId_idx" ON "Company"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");

-- CreateIndex
CREATE INDEX "Project_locationId_isActive_idx" ON "Project"("locationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "UserType_code_key" ON "UserType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "UserType_name_key" ON "UserType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_userTypeId_isActive_idx" ON "User"("userTypeId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentType_code_key" ON "DocumentType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentType_name_key" ON "DocumentType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSubtype_documentTypeId_code_key" ON "DocumentSubtype"("documentTypeId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSubtype_documentTypeId_name_key" ON "DocumentSubtype"("documentTypeId", "name");

-- CreateIndex
CREATE INDEX "FieldDefinition_documentTypeId_documentSubtypeId_isActive_idx" ON "FieldDefinition"("documentTypeId", "documentSubtypeId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "FieldDefinition_documentTypeId_documentSubtypeId_fieldGroup_key" ON "FieldDefinition"("documentTypeId", "documentSubtypeId", "fieldGroup", "fieldKey");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentNumberCounter_documentTypeId_projectId_periodYear_key" ON "DocumentNumberCounter"("documentTypeId", "projectId", "periodYear");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE INDEX "UserAssignment_userId_idx" ON "UserAssignment"("userId");

-- CreateIndex
CREATE INDEX "UserAssignment_roleId_idx" ON "UserAssignment"("roleId");

-- CreateIndex
CREATE INDEX "UserAssignment_projectId_idx" ON "UserAssignment"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAssignment_userId_roleId_companyId_projectId_locationId_key" ON "UserAssignment"("userId", "roleId", "companyId", "projectId", "locationId", "documentTypeId", "documentSubtypeId", "processDefinitionId");

-- CreateIndex
CREATE INDEX "ApprovalDelegation_delegateUserId_idx" ON "ApprovalDelegation"("delegateUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalDelegation_delegatorUserId_delegateUserId_key" ON "ApprovalDelegation"("delegatorUserId", "delegateUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentWorkflowTemplate_code_key" ON "DocumentWorkflowTemplate"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentWorkflowStep_templateId_stepNumber_key" ON "DocumentWorkflowStep"("templateId", "stepNumber");

-- CreateIndex
CREATE INDEX "DocumentWorkflowStepApprover_stepId_idx" ON "DocumentWorkflowStepApprover"("stepId");

-- CreateIndex
CREATE INDEX "DocumentWorkflowStepApprover_userId_idx" ON "DocumentWorkflowStepApprover"("userId");

-- CreateIndex
CREATE INDEX "DocumentWorkflowStepApprover_userTypeId_idx" ON "DocumentWorkflowStepApprover"("userTypeId");

-- CreateIndex
CREATE INDEX "DocumentWorkflowAssignment_templateId_idx" ON "DocumentWorkflowAssignment"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentWorkflowAssignment_documentTypeId_documentSubtypeId_key" ON "DocumentWorkflowAssignment"("documentTypeId", "documentSubtypeId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_documentNumber_key" ON "Document"("documentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Document_submissionKey_key" ON "Document"("submissionKey");

-- CreateIndex
CREATE INDEX "Document_createdById_idx" ON "Document"("createdById");

-- CreateIndex
CREATE INDEX "Document_workflowTemplateId_idx" ON "Document"("workflowTemplateId");

-- CreateIndex
CREATE INDEX "Document_documentTypeId_documentSubtypeId_idx" ON "Document"("documentTypeId", "documentSubtypeId");

-- CreateIndex
CREATE INDEX "Document_projectId_status_idx" ON "Document"("projectId", "status");

-- CreateIndex
CREATE INDEX "Document_status_currentWorkflowStep_idx" ON "Document"("status", "currentWorkflowStep");

-- CreateIndex
CREATE INDEX "Document_createdAt_idx" ON "Document"("createdAt");

-- CreateIndex
CREATE INDEX "Document_receivedById_idx" ON "Document"("receivedById");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentLineItem_documentId_lineNo_key" ON "DocumentLineItem"("documentId", "lineNo");

-- CreateIndex
CREATE INDEX "DocumentFieldValue_fieldDefinitionId_idx" ON "DocumentFieldValue"("fieldDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentFieldValue_documentId_fieldDefinitionId_lineItemId_key" ON "DocumentFieldValue"("documentId", "fieldDefinitionId", "lineItemId");

-- CreateIndex
CREATE INDEX "DocumentVersion_documentId_idx" ON "DocumentVersion"("documentId");

-- CreateIndex
CREATE INDEX "DocumentVersion_uploadedById_idx" ON "DocumentVersion"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_versionNumber_key" ON "DocumentVersion"("documentId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessDefinition_name_key" ON "ProcessDefinition"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessStep_processDefinitionId_stepNumber_key" ON "ProcessStep"("processDefinitionId", "stepNumber");

-- CreateIndex
CREATE INDEX "ProcessInstance_processDefinitionId_status_idx" ON "ProcessInstance"("processDefinitionId", "status");

-- CreateIndex
CREATE INDEX "ProcessInstance_projectId_idx" ON "ProcessInstance"("projectId");

-- CreateIndex
CREATE INDEX "ProcessStepDocument_documentId_idx" ON "ProcessStepDocument"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessStepDocument_processInstanceId_processStepId_documen_key" ON "ProcessStepDocument"("processInstanceId", "processStepId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentApprovalStep_documentId_levelNumber_key" ON "DocumentApprovalStep"("documentId", "levelNumber");

-- CreateIndex
CREATE INDEX "DocumentApprovalStepApprover_stepId_idx" ON "DocumentApprovalStepApprover"("stepId");

-- CreateIndex
CREATE INDEX "DocumentApprovalStepApprover_userId_idx" ON "DocumentApprovalStepApprover"("userId");

-- CreateIndex
CREATE INDEX "DocumentApprovalStepApprover_userTypeId_idx" ON "DocumentApprovalStepApprover"("userTypeId");

-- CreateIndex
CREATE INDEX "ApprovalHistory_documentId_performedAt_idx" ON "ApprovalHistory"("documentId", "performedAt");

-- CreateIndex
CREATE INDEX "ApprovalHistory_performedById_idx" ON "ApprovalHistory"("performedById");

-- CreateIndex
CREATE INDEX "ApprovalHistory_versionId_idx" ON "ApprovalHistory"("versionId");

-- CreateIndex
CREATE INDEX "ApprovalHistory_outputVersionId_idx" ON "ApprovalHistory"("outputVersionId");

-- CreateIndex
CREATE INDEX "DeletionRequest_requestedById_idx" ON "DeletionRequest"("requestedById");

-- CreateIndex
CREATE INDEX "DeletionRequest_approverId_idx" ON "DeletionRequest"("approverId");

-- CreateIndex
CREATE INDEX "DeletionRequest_status_idx" ON "DeletionRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DeletionRequest_documentId_status_key" ON "DeletionRequest"("documentId", "status");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_isRead_idx" ON "Notification"("isRead");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_eventKey_userId_key" ON "Notification"("eventKey", "userId");

-- CreateIndex
CREATE INDEX "EmailNotificationEvent_emailDueAt_emailSent_claimedAt_idx" ON "EmailNotificationEvent"("emailDueAt", "emailSent", "claimedAt");

-- CreateIndex
CREATE INDEX "EmailNotificationEvent_recipientId_emailDueAt_idx" ON "EmailNotificationEvent"("recipientId", "emailDueAt");

-- CreateIndex
CREATE INDEX "EmailNotificationEvent_type_documentId_createdAt_idx" ON "EmailNotificationEvent"("type", "documentId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_documentId_createdAt_idx" ON "AuditLog"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_performedById_createdAt_idx" ON "AuditLog"("performedById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrustedDevice_tokenHash_key" ON "TrustedDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "TrustedDevice_userId_expiresAt_idx" ON "TrustedDevice"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "TrustedDevice_userId_revokedAt_idx" ON "TrustedDevice"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OtpChallenge_challengeTokenHash_key" ON "OtpChallenge"("challengeTokenHash");

-- CreateIndex
CREATE INDEX "OtpChallenge_userId_createdAt_idx" ON "OtpChallenge"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "OtpChallenge_userId_expiresAt_idx" ON "OtpChallenge"("userId", "expiresAt");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_userTypeId_fkey" FOREIGN KEY ("userTypeId") REFERENCES "UserType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSubtype" ADD CONSTRAINT "DocumentSubtype_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "DocumentType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldDefinition" ADD CONSTRAINT "FieldDefinition_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "DocumentType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldDefinition" ADD CONSTRAINT "FieldDefinition_documentSubtypeId_fkey" FOREIGN KEY ("documentSubtypeId") REFERENCES "DocumentSubtype"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentNumberCounter" ADD CONSTRAINT "DocumentNumberCounter_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "DocumentType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentNumberCounter" ADD CONSTRAINT "DocumentNumberCounter_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAssignment" ADD CONSTRAINT "UserAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAssignment" ADD CONSTRAINT "UserAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAssignment" ADD CONSTRAINT "UserAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAssignment" ADD CONSTRAINT "UserAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAssignment" ADD CONSTRAINT "UserAssignment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAssignment" ADD CONSTRAINT "UserAssignment_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "DocumentType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAssignment" ADD CONSTRAINT "UserAssignment_documentSubtypeId_fkey" FOREIGN KEY ("documentSubtypeId") REFERENCES "DocumentSubtype"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAssignment" ADD CONSTRAINT "UserAssignment_processDefinitionId_fkey" FOREIGN KEY ("processDefinitionId") REFERENCES "ProcessDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDelegation" ADD CONSTRAINT "ApprovalDelegation_delegatorUserId_fkey" FOREIGN KEY ("delegatorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDelegation" ADD CONSTRAINT "ApprovalDelegation_delegateUserId_fkey" FOREIGN KEY ("delegateUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDelegation" ADD CONSTRAINT "ApprovalDelegation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentWorkflowStep" ADD CONSTRAINT "DocumentWorkflowStep_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentWorkflowTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentWorkflowStepApprover" ADD CONSTRAINT "DocumentWorkflowStepApprover_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "DocumentWorkflowStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentWorkflowStepApprover" ADD CONSTRAINT "DocumentWorkflowStepApprover_userTypeId_fkey" FOREIGN KEY ("userTypeId") REFERENCES "UserType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentWorkflowStepApprover" ADD CONSTRAINT "DocumentWorkflowStepApprover_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentWorkflowAssignment" ADD CONSTRAINT "DocumentWorkflowAssignment_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "DocumentType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentWorkflowAssignment" ADD CONSTRAINT "DocumentWorkflowAssignment_documentSubtypeId_fkey" FOREIGN KEY ("documentSubtypeId") REFERENCES "DocumentSubtype"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentWorkflowAssignment" ADD CONSTRAINT "DocumentWorkflowAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentWorkflowAssignment" ADD CONSTRAINT "DocumentWorkflowAssignment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentWorkflowTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "DocumentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_documentSubtypeId_fkey" FOREIGN KEY ("documentSubtypeId") REFERENCES "DocumentSubtype"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_workflowTemplateId_fkey" FOREIGN KEY ("workflowTemplateId") REFERENCES "DocumentWorkflowTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLineItem" ADD CONSTRAINT "DocumentLineItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentFieldValue" ADD CONSTRAINT "DocumentFieldValue_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentFieldValue" ADD CONSTRAINT "DocumentFieldValue_fieldDefinitionId_fkey" FOREIGN KEY ("fieldDefinitionId") REFERENCES "FieldDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentFieldValue" ADD CONSTRAINT "DocumentFieldValue_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "DocumentLineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessStep" ADD CONSTRAINT "ProcessStep_processDefinitionId_fkey" FOREIGN KEY ("processDefinitionId") REFERENCES "ProcessDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessStep" ADD CONSTRAINT "ProcessStep_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "DocumentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessStep" ADD CONSTRAINT "ProcessStep_documentSubtypeId_fkey" FOREIGN KEY ("documentSubtypeId") REFERENCES "DocumentSubtype"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessInstance" ADD CONSTRAINT "ProcessInstance_processDefinitionId_fkey" FOREIGN KEY ("processDefinitionId") REFERENCES "ProcessDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessInstance" ADD CONSTRAINT "ProcessInstance_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessInstance" ADD CONSTRAINT "ProcessInstance_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessStepDocument" ADD CONSTRAINT "ProcessStepDocument_processInstanceId_fkey" FOREIGN KEY ("processInstanceId") REFERENCES "ProcessInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessStepDocument" ADD CONSTRAINT "ProcessStepDocument_processStepId_fkey" FOREIGN KEY ("processStepId") REFERENCES "ProcessStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessStepDocument" ADD CONSTRAINT "ProcessStepDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessStepDocument" ADD CONSTRAINT "ProcessStepDocument_linkedById_fkey" FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentApprovalStep" ADD CONSTRAINT "DocumentApprovalStep_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentApprovalStep" ADD CONSTRAINT "DocumentApprovalStep_actedById_fkey" FOREIGN KEY ("actedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentApprovalStepApprover" ADD CONSTRAINT "DocumentApprovalStepApprover_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "DocumentApprovalStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentApprovalStepApprover" ADD CONSTRAINT "DocumentApprovalStepApprover_userTypeId_fkey" FOREIGN KEY ("userTypeId") REFERENCES "UserType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentApprovalStepApprover" ADD CONSTRAINT "DocumentApprovalStepApprover_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalHistory" ADD CONSTRAINT "ApprovalHistory_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalHistory" ADD CONSTRAINT "ApprovalHistory_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalHistory" ADD CONSTRAINT "ApprovalHistory_onBehalfOfUserId_fkey" FOREIGN KEY ("onBehalfOfUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalHistory" ADD CONSTRAINT "ApprovalHistory_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalHistory" ADD CONSTRAINT "ApprovalHistory_outputVersionId_fkey" FOREIGN KEY ("outputVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletionRequest" ADD CONSTRAINT "DeletionRequest_adminReviewerId_fkey" FOREIGN KEY ("adminReviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletionRequest" ADD CONSTRAINT "DeletionRequest_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletionRequest" ADD CONSTRAINT "DeletionRequest_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletionRequest" ADD CONSTRAINT "DeletionRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailNotificationEvent" ADD CONSTRAINT "EmailNotificationEvent_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedDevice" ADD CONSTRAINT "TrustedDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
