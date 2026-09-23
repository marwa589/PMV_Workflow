ALTER TABLE "PurchaseOrder" ADD COLUMN "receivedAt" TIMESTAMP(3),
ADD COLUMN "receivedById" TEXT;

CREATE INDEX "PurchaseOrder_receivedById_idx" ON "PurchaseOrder"("receivedById");

ALTER TABLE "PurchaseOrder"
ADD CONSTRAINT "PurchaseOrder_receivedById_fkey"
FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;