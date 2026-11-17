-- Taking a unique track (at upload, or from an approval level) needs the "Use unique tracks" permission for the
-- document. Admin users always have it. Nobody else has it until an admin adds it to a role in Roles & Access.
INSERT INTO "Permission" ("id", "code", "name", "description")
SELECT 'perm_' || md5(random()::text), 'documents.use_unique_track', 'Use unique tracks',
  'Lets the person send documents inside the scope down a unique track of the approval flow, when uploading or when approving at a level that has tracks. Admin users always have it.'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'documents.use_unique_track');
