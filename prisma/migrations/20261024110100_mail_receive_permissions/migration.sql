-- Mailing list: "receives mail" permissions. Hand them out through roles and assignments (scope = project, location, type, sub type).
INSERT INTO "Permission" ("id", "code", "name", "description") VALUES
  (gen_random_uuid()::text, 'mail.receive_approved', 'Receive mail: approved', 'Get an email when a document in scope is fully approved'),
  (gen_random_uuid()::text, 'mail.receive_rejected', 'Receive mail: rejected', 'Get an email when a document in scope is rejected'),
  (gen_random_uuid()::text, 'mail.receive_revision', 'Receive mail: revision requested', 'Get an email when a document in scope is sent back for revision')
ON CONFLICT ("code") DO NOTHING;
