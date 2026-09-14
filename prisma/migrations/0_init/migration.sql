-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CLERK', 'APPROVER_1', 'APPROVER_2', 'APPROVER_3', 'ADMIN', 'ERR_USER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING_APPROVER_1', 'PENDING_APPROVER_2', 'PENDING_APPROVER_3', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ApprovalActionType" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'REQUESTED_REVISION');

-- CreateEnum
CREATE TYPE "DeletionRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('COMPARISON', 'MATERIAL_REQUISITION');

-- CreateEnum
CREATE TYPE "ComparisonType" AS ENUM ('SPARE_PARTS', 'OTHER');

-- CreateEnum
CREATE TYPE "MrType" AS ENUM ('CASH', 'CREDIT');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('PENDING_APPROVAL', 'DOCUMENT_APPROVED', 'DOCUMENT_REJECTED', 'DOCUMENT_REVISED', 'DOCUMENT_DELETED');

-- CreateEnum
CREATE TYPE "EmailEventType" AS ENUM ('APPROVAL_PENDING', 'WORKFLOW_APPROVED', 'WORKFLOW_REJECTED', 'APPROVAL_OVERDUE', 'COMPARISON_MR_OVERDUE');

-- CreateEnum
CREATE TYPE "ErrType" AS ENUM ('RENTAL_ACTC', 'RENTAL_EXTERNAL', 'PURCHASE');

-- CreateEnum
CREATE TYPE "ErrStatus" AS ENUM ('PENDING', 'ON_HOLD', 'REVISION_REQUIRED', 'REJECTED', 'APPROVED');

-- CreateEnum
CREATE TYPE "ErrStage" AS ENUM ('PROJECT_DIRECTOR', 'PMV_MANAGER', 'ACTING_CEO', 'CEO');

-- CreateEnum
CREATE TYPE "ErrFileKind" AS ENUM ('ERR_PDF', 'QUOTATION', 'ATTACHMENT', 'RELEASE_VOUCHER', 'RECEIPT_VOUCHER');

-- CreateEnum
CREATE TYPE "ErrAction" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'REQUESTED_REVISION', 'PUT_ON_HOLD', 'RESUMED', 'RESUBMITTED', 'COMMENTED', 'RELEASE_VOUCHER_ADDED', 'RECEIPT_VOUCHER_ADDED');

-- CreateEnum
CREATE TYPE "ErrAccessRole" AS ENUM ('UPLOADER', 'PROJECT_DIRECTOR', 'ACTING_CEO', 'CEO', 'VIEWER');

-- CreateEnum
CREATE TYPE "ErrNotificationType" AS ENUM ('APPROVAL_PENDING', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED', 'ON_HOLD', 'RESUMED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
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
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "DocumentStatus" NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "currentApproverId" TEXT,
    "documentType" "DocumentType" NOT NULL DEFAULT 'COMPARISON',
    "comparisonType" "ComparisonType",
    "mrType" "MrType",
    "currentApproverAssignedAt" TIMESTAMP(3),
    "downloadedAt" TIMESTAMP(3),
    "mrNumber" TEXT,
    "relatedComparisonId" TEXT,
    "lastActiveStage" "DocumentStatus",

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "extension" TEXT,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT NOT NULL,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
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

    CONSTRAINT "ApprovalHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletionRequest" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approver3Id" TEXT,
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

-- CreateTable
CREATE TABLE "Err" (
    "id" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "submissionKey" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "ErrType" NOT NULL,
    "status" "ErrStatus" NOT NULL DEFAULT 'PENDING',
    "currentStage" "ErrStage" NOT NULL DEFAULT 'PROJECT_DIRECTOR',
    "createdById" TEXT NOT NULL,
    "projectDirectorId" TEXT NOT NULL,
    "currentApproverId" TEXT,
    "currentApproverAssignedAt" TIMESTAMP(3),
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,
    "lockVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "projectId" TEXT,
    "projectNameSnapshot" TEXT,

    CONSTRAINT "Err_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrSequence" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErrSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrFile" (
    "id" TEXT NOT NULL,
    "errId" TEXT NOT NULL,
    "kind" "ErrFileKind" NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,
    "filePath" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrApprovalHistory" (
    "id" TEXT NOT NULL,
    "errId" TEXT NOT NULL,
    "performedById" TEXT NOT NULL,
    "action" "ErrAction" NOT NULL,
    "stage" "ErrStage",
    "comments" TEXT,
    "revisionNumber" INTEGER NOT NULL,
    "inputFileId" TEXT,
    "outputFileId" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrApprovalHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrUserAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ErrAccessRole" NOT NULL,
    "projectId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErrUserAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrNotification" (
    "id" TEXT NOT NULL,
    "errId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "type" "ErrNotificationType" NOT NULL,
    "eventKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "emailSentAt" TIMESTAMP(3),
    "emailAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextEmailAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailClaimedAt" TIMESTAMP(3),
    "lastEmailError" TEXT,

    CONSTRAINT "ErrNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrProject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "directorId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErrProject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Document_documentNumber_key" ON "Document"("documentNumber");

-- CreateIndex
CREATE INDEX "Document_createdById_idx" ON "Document"("createdById");

-- CreateIndex
CREATE INDEX "Document_currentApproverId_idx" ON "Document"("currentApproverId");

-- CreateIndex
CREATE INDEX "Document_relatedComparisonId_idx" ON "Document"("relatedComparisonId");

-- CreateIndex
CREATE INDEX "Document_status_idx" ON "Document"("status");

-- CreateIndex
CREATE INDEX "DocumentVersion_documentId_idx" ON "DocumentVersion"("documentId");

-- CreateIndex
CREATE INDEX "DocumentVersion_uploadedById_idx" ON "DocumentVersion"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_versionNumber_key" ON "DocumentVersion"("documentId", "versionNumber");

-- CreateIndex
CREATE INDEX "ApprovalHistory_documentId_performedAt_idx" ON "ApprovalHistory"("documentId", "performedAt");

-- CreateIndex
CREATE INDEX "ApprovalHistory_performedById_idx" ON "ApprovalHistory"("performedById");

-- CreateIndex
CREATE INDEX "ApprovalHistory_versionId_idx" ON "ApprovalHistory"("versionId");

-- CreateIndex
CREATE INDEX "DeletionRequest_requestedById_idx" ON "DeletionRequest"("requestedById");

-- CreateIndex
CREATE INDEX "DeletionRequest_approver3Id_idx" ON "DeletionRequest"("approver3Id");

-- CreateIndex
CREATE INDEX "DeletionRequest_status_idx" ON "DeletionRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DeletionRequest_documentId_status_key" ON "DeletionRequest"("documentId", "status");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_isRead_idx" ON "Notification"("isRead");

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

-- CreateIndex
CREATE UNIQUE INDEX "Err_documentNumber_key" ON "Err"("documentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Err_submissionKey_key" ON "Err"("submissionKey");

-- CreateIndex
CREATE INDEX "Err_createdById_status_idx" ON "Err"("createdById", "status");

-- CreateIndex
CREATE INDEX "Err_projectDirectorId_status_idx" ON "Err"("projectDirectorId", "status");

-- CreateIndex
CREATE INDEX "Err_currentApproverId_status_idx" ON "Err"("currentApproverId", "status");

-- CreateIndex
CREATE INDEX "Err_status_currentStage_idx" ON "Err"("status", "currentStage");

-- CreateIndex
CREATE INDEX "Err_createdAt_idx" ON "Err"("createdAt");

-- CreateIndex
CREATE INDEX "Err_projectId_status_idx" ON "Err"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ErrFile_filePath_key" ON "ErrFile"("filePath");

-- CreateIndex
CREATE INDEX "ErrFile_uploadedById_idx" ON "ErrFile"("uploadedById");

-- CreateIndex
CREATE INDEX "ErrFile_errId_revisionNumber_idx" ON "ErrFile"("errId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ErrFile_errId_kind_versionNumber_key" ON "ErrFile"("errId", "kind", "versionNumber");

-- CreateIndex
CREATE INDEX "ErrApprovalHistory_errId_performedAt_idx" ON "ErrApprovalHistory"("errId", "performedAt");

-- CreateIndex
CREATE INDEX "ErrApprovalHistory_performedById_idx" ON "ErrApprovalHistory"("performedById");

-- CreateIndex
CREATE INDEX "ErrApprovalHistory_inputFileId_idx" ON "ErrApprovalHistory"("inputFileId");

-- CreateIndex
CREATE INDEX "ErrApprovalHistory_outputFileId_idx" ON "ErrApprovalHistory"("outputFileId");

-- CreateIndex
CREATE INDEX "ErrUserAccess_role_isActive_idx" ON "ErrUserAccess"("role", "isActive");

-- CreateIndex
CREATE INDEX "ErrUserAccess_projectId_isActive_idx" ON "ErrUserAccess"("projectId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ErrUserAccess_userId_role_projectId_key" ON "ErrUserAccess"("userId", "role", "projectId");

-- CreateIndex
CREATE INDEX "ErrNotification_recipientId_readAt_createdAt_idx" ON "ErrNotification"("recipientId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "ErrNotification_errId_idx" ON "ErrNotification"("errId");

-- CreateIndex
CREATE INDEX "ErrNotification_emailEnabled_emailSentAt_nextEmailAt_idx" ON "ErrNotification"("emailEnabled", "emailSentAt", "nextEmailAt");

-- CreateIndex
CREATE UNIQUE INDEX "ErrNotification_eventKey_recipientId_key" ON "ErrNotification"("eventKey", "recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "ErrProject_name_key" ON "ErrProject"("name");

-- CreateIndex
CREATE INDEX "ErrProject_directorId_isActive_idx" ON "ErrProject"("directorId", "isActive");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_currentApproverId_fkey" FOREIGN KEY ("currentApproverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_relatedComparisonId_fkey" FOREIGN KEY ("relatedComparisonId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalHistory" ADD CONSTRAINT "ApprovalHistory_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalHistory" ADD CONSTRAINT "ApprovalHistory_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalHistory" ADD CONSTRAINT "ApprovalHistory_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletionRequest" ADD CONSTRAINT "DeletionRequest_adminReviewerId_fkey" FOREIGN KEY ("adminReviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletionRequest" ADD CONSTRAINT "DeletionRequest_approver3Id_fkey" FOREIGN KEY ("approver3Id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "Err" ADD CONSTRAINT "Err_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Err" ADD CONSTRAINT "Err_projectDirectorId_fkey" FOREIGN KEY ("projectDirectorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Err" ADD CONSTRAINT "Err_currentApproverId_fkey" FOREIGN KEY ("currentApproverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Err" ADD CONSTRAINT "Err_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ErrProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrFile" ADD CONSTRAINT "ErrFile_errId_fkey" FOREIGN KEY ("errId") REFERENCES "Err"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrFile" ADD CONSTRAINT "ErrFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrApprovalHistory" ADD CONSTRAINT "ErrApprovalHistory_errId_fkey" FOREIGN KEY ("errId") REFERENCES "Err"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrApprovalHistory" ADD CONSTRAINT "ErrApprovalHistory_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrApprovalHistory" ADD CONSTRAINT "ErrApprovalHistory_inputFileId_fkey" FOREIGN KEY ("inputFileId") REFERENCES "ErrFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrApprovalHistory" ADD CONSTRAINT "ErrApprovalHistory_outputFileId_fkey" FOREIGN KEY ("outputFileId") REFERENCES "ErrFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrUserAccess" ADD CONSTRAINT "ErrUserAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrUserAccess" ADD CONSTRAINT "ErrUserAccess_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ErrProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrNotification" ADD CONSTRAINT "ErrNotification_errId_fkey" FOREIGN KEY ("errId") REFERENCES "Err"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrNotification" ADD CONSTRAINT "ErrNotification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrProject" ADD CONSTRAINT "ErrProject_directorId_fkey" FOREIGN KEY ("directorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
