ALTER TYPE "DocumentType" ADD VALUE 'CUSTODY';

CREATE TABLE "CustodyFileSequence" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "nextNumber" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustodyFileSequence_pkey" PRIMARY KEY ("id")
);