-- "Allow multiple uploads" is a setting of the process step (off by default).
ALTER TABLE "ProcessStep" ADD COLUMN IF NOT EXISTS "allowMultipleUploads" BOOLEAN NOT NULL DEFAULT false;
