-- Per-user switch: may this user approve several documents together (off = one by one).
ALTER TABLE "User" ADD COLUMN "canBulkApprove" BOOLEAN NOT NULL DEFAULT false;
