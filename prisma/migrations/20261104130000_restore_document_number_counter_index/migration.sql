-- Repair: document numbering does INSERT ... ON CONFLICT on this unique expression index, and Prisma cannot
-- declare it in schema.prisma, so `prisma db push` (or a reset followed by one) silently drops it.
-- Without it every upload fails with Postgres error 42P10 "no unique or exclusion constraint matching the ON CONFLICT specification".
-- Safe to run when the index already exists.

-- While the index was missing, two uploads could have created a second counter row for the same scope.
-- Keep the row with the highest value so numbers are never reused, then the index can be created.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "documentTypeId", COALESCE("documentSubtypeId", ''), COALESCE("projectId", ''), "periodYear"
      ORDER BY "lastValue" DESC, "id"
    ) AS rn
  FROM "DocumentNumberCounter"
)
DELETE FROM "DocumentNumberCounter" AS counter
USING ranked
WHERE counter."id" = ranked."id" AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentNumberCounter_scope_key"
  ON "DocumentNumberCounter" (
    "documentTypeId",
    COALESCE("documentSubtypeId", ''),
    COALESCE("projectId", ''),
    "periodYear"
  );
