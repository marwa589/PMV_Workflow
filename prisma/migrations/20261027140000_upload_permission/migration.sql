-- New permission: upload documents in the scope of an assignment.
INSERT INTO "Permission" ("id", "code", "name", "description")
SELECT 'perm_' || md5(random()::text), 'documents.upload', 'Upload documents',
  'Upload documents of the types, sub types and projects covered by the assignment. Works on top of the approval flow''s Uploader level, which still lets the people it names upload.'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'documents.upload');
