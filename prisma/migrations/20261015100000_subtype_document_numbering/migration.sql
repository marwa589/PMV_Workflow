ALTER TABLE "DocumentType"
  ADD COLUMN IF NOT EXISTS "numberingCode" TEXT NOT NULL DEFAULT '';

ALTER TABLE "DocumentSubtype"
  ADD COLUMN IF NOT EXISTS "numberingCode" TEXT NOT NULL DEFAULT '';

UPDATE "DocumentType"
SET "numberingCode" = CASE WHEN "code" = 'COMP' THEN 'COM' ELSE "code" END;

UPDATE "DocumentSubtype" AS subtype
SET "numberingCode" = CASE
  WHEN type."code" = 'COMP' AND subtype."code" = 'SPARE_PARTS' THEN 'SP'
  WHEN type."code" = 'COMP' AND subtype."code" = 'OTHER' THEN 'OT'
  WHEN type."code" = 'MR' AND subtype."code" = 'CASH' THEN 'CH'
  WHEN type."code" = 'MR' AND subtype."code" = 'CREDIT' THEN 'CR'
  WHEN type."code" = 'MR' AND subtype."code" = 'ADVANCE_PAYMENT' THEN 'AP'
  WHEN type."code" = 'MR' AND subtype."code" = 'PETTY_CASH' THEN 'PC'
  WHEN type."code" = 'ERR' AND subtype."code" = 'RENTAL_ACTC' THEN 'ACTC'
  WHEN type."code" = 'ERR' AND subtype."code" = 'RENTAL_EXTERNAL' THEN 'EXT'
  WHEN type."code" = 'ERR' AND subtype."code" = 'RENEWAL' THEN 'REN'
  WHEN type."code" = 'ERR' AND subtype."code" = 'PURCHASE' THEN 'PUR'
  WHEN type."code" = 'RV' AND subtype."code" = 'RELEASE' THEN 'REL'
  WHEN type."code" = 'RV' AND subtype."code" = 'RECEIPT' THEN 'REC'
  ELSE subtype."code"
END
FROM "DocumentType" AS type
WHERE subtype."documentTypeId" = type."id";

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentType_numberingCode_key" ON "DocumentType"("numberingCode");
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentSubtype_documentTypeId_numberingCode_key"
  ON "DocumentSubtype"("documentTypeId", "numberingCode");

ALTER TABLE "DocumentNumberCounter"
  ADD COLUMN IF NOT EXISTS "documentSubtypeId" TEXT;

ALTER TABLE "DocumentNumberCounter"
  DROP CONSTRAINT IF EXISTS "DocumentNumberCounter_documentTypeId_projectId_periodYear_key";

DROP INDEX IF EXISTS "DocumentNumberCounter_scope_key";
DROP INDEX IF EXISTS "DocumentNumberCounter_type_project_year_key";
DROP INDEX IF EXISTS "DocumentNumberCounter_documentTypeId_projectId_periodYear_key";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'DocumentNumberCounter_documentSubtypeId_fkey'
      AND conrelid = '"DocumentNumberCounter"'::regclass
  ) THEN
    ALTER TABLE "DocumentNumberCounter"
      ADD CONSTRAINT "DocumentNumberCounter_documentSubtypeId_fkey"
      FOREIGN KEY ("documentSubtypeId") REFERENCES "DocumentSubtype"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "DocumentNumberCounter_documentTypeId_documentSubtypeId_projectId_periodYear_idx"
  ON "DocumentNumberCounter"("documentTypeId", "documentSubtypeId", "projectId", "periodYear");

UPDATE "Document" AS document
SET "documentNumber" = '__subtype_number_migration__' || document."id"
WHERE document."documentSubtypeId" IS NOT NULL;

WITH numbered AS (
  SELECT
    document."id",
    type."numberingCode" AS type_code,
    subtype."numberingCode" AS subtype_code,
    EXTRACT(YEAR FROM document."createdAt" AT TIME ZONE 'UTC')::int AS period_year,
    ROW_NUMBER() OVER (
      PARTITION BY document."documentSubtypeId",
        EXTRACT(YEAR FROM document."createdAt" AT TIME ZONE 'UTC')
      ORDER BY document."createdAt", document."id"
    ) AS sequence
  FROM "Document" AS document
  JOIN "DocumentType" AS type ON type."id" = document."documentTypeId"
  JOIN "DocumentSubtype" AS subtype ON subtype."id" = document."documentSubtypeId"
  WHERE document."documentSubtypeId" IS NOT NULL
)
UPDATE "Document" AS document
SET "documentNumber" = numbered.type_code || '-' || numbered.subtype_code || '-' ||
  numbered.period_year::text || '-' ||
  LPAD(numbered.sequence::text, GREATEST(4, LENGTH(numbered.sequence::text)), '0')
FROM numbered
WHERE document."id" = numbered."id";

INSERT INTO "DocumentNumberCounter" ("id", "documentTypeId", "documentSubtypeId", "projectId", "periodYear", "lastValue")
SELECT
  gen_random_uuid()::text,
  document."documentTypeId",
  document."documentSubtypeId",
  NULL,
  EXTRACT(YEAR FROM document."createdAt" AT TIME ZONE 'UTC')::int,
  COUNT(*)::int
FROM "Document" AS document
WHERE document."documentSubtypeId" IS NOT NULL
GROUP BY document."documentTypeId", document."documentSubtypeId",
  EXTRACT(YEAR FROM document."createdAt" AT TIME ZONE 'UTC');

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentNumberCounter_scope_key"
  ON "DocumentNumberCounter" (
    "documentTypeId",
    COALESCE("documentSubtypeId", ''),
    COALESCE("projectId", ''),
    "periodYear"
  );
