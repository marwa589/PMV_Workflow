CREATE TABLE "DocumentNumberSequence" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "lastNumber" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DocumentNumberSequence_pkey" PRIMARY KEY ("id")
);

INSERT INTO "DocumentNumberSequence" ("id", "lastNumber", "updatedAt")
SELECT
  1,
  COALESCE(MAX(SUBSTRING("documentNumber" FROM '^DOC-([0-9]+)$')::INTEGER), 0),
  CURRENT_TIMESTAMP
FROM "Document";