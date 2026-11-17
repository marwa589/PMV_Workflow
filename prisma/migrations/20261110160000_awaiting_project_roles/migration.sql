-- A level whose Project Director / Manager is missing no longer blocks the upload: it waits for one to be assigned.
ALTER TABLE "DocumentApprovalStep" ADD COLUMN "awaitingProjectDirector" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DocumentApprovalStep" ADD COLUMN "awaitingProjectManager" BOOLEAN NOT NULL DEFAULT false;

-- The old "Mailing List" roles only granted View; emails are set on the Mailing List page. They are removed (only
-- when nobody holds them, so nobody silently loses access).
DELETE FROM "Role" r
WHERE r."name" IN ('Mailing List (all events)', 'Mailing List (approved only)')
  AND NOT EXISTS (SELECT 1 FROM "UserAssignment" ua WHERE ua."roleId" = r."id");
