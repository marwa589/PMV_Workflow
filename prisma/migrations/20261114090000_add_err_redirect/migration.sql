-- Marc can redirect an ERR at his (PMV Manager) stage to another user; when that user approves,
-- the ERR comes back to Marc. redirectedById is set only while the ERR is with that user.
ALTER TYPE "ErrAction" ADD VALUE IF NOT EXISTS 'REDIRECTED';
ALTER TYPE "ErrAction" ADD VALUE IF NOT EXISTS 'REDIRECT_APPROVED';

ALTER TABLE "Err" ADD COLUMN "redirectedById" TEXT;

CREATE INDEX "Err_redirectedById_idx" ON "Err"("redirectedById");

ALTER TABLE "Err"
    ADD CONSTRAINT "Err_redirectedById_fkey"
    FOREIGN KEY ("redirectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
