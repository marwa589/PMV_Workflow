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

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'ERR_USER';

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
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

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

CREATE UNIQUE INDEX IF NOT EXISTS "ErrUserAccess_userId_role_global_key"
ON "ErrUserAccess" ("userId", "role")
WHERE "projectId" IS NULL;