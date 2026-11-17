-- How many hours pass between two summary emails to the same person (one row, id "global"; no row = every 1 hour).
CREATE TABLE "MailDigestConfig" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "intervalHours" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailDigestConfig_pkey" PRIMARY KEY ("id")
);
