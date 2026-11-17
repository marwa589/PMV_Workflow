-- Process views and starts are no longer permissions, and three permissions were never checked anywhere.
-- Deleting a permission also removes it from every role.
DELETE FROM "Permission" WHERE "code" IN (
  'processes.view', 'processes.start', 'documents.create', 'documents.edit', 'analytics.view'
);

-- Roles that existed only for those permissions are removed when nobody holds them.
-- A role that still has assignments is kept (now without those permissions) so no one loses an assignment silently.
DELETE FROM "Role" r
WHERE r."name" IN ('Process Starter', 'Editor', 'Analyst')
  AND NOT EXISTS (SELECT 1 FROM "UserAssignment" ua WHERE ua."roleId" = r."id");
