-- Create the approval path enum
CREATE TYPE "ErrApprovalPath" AS ENUM (
  'FINALIZE',
  'ACTING_CEO',
  'ACTING_CEO_THEN_CEO'
);

-- Add the tracked path for PMV manager-to-acting CEO routing
ALTER TABLE "Err"
ADD COLUMN "nextApprovalPath" "ErrApprovalPath";
