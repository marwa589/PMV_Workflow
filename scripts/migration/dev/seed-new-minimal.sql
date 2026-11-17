-- Test-only stand-in for `npm run db:seed` (Prisma cannot run in the sandbox). Not used in production.
INSERT INTO "UserType" (id, code, name) VALUES ('ut1','clerk','Clerk'),('ut2','eng','Engineer'),('ut3','manager','Manager'),('ut4','admin','Admin') ON CONFLICT DO NOTHING;
INSERT INTO "Permission" (id, code, name) SELECT 'p'||g, 'documents.p'||g, 'p'||g FROM generate_series(1,12) g ON CONFLICT DO NOTHING;
INSERT INTO "Role" (id, name) SELECT 'r'||g, 'Role '||g FROM generate_series(1,6) g ON CONFLICT DO NOTHING;
INSERT INTO "DocumentType" (id, code, "numberingCode", name) VALUES ('t1','MR','MR','Material Req'),('t2','COMP','COM','Comp Sheet'),('t3','ERR','ERR','Eq Rental Req'),('t4','PO','PO','Purchase Order') ON CONFLICT DO NOTHING;
INSERT INTO "Permission" (id, code, name) VALUES ('pdr','documents.delete_request','Request deletion'),('pdv','documents.view','View') ON CONFLICT DO NOTHING;
INSERT INTO "Role" (id, name) VALUES ('rU','Uploader'),('rV','Viewer'),('rA','Approver') ON CONFLICT DO NOTHING;
