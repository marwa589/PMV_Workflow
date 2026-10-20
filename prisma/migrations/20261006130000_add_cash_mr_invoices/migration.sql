ALTER TABLE "PurchaseOrderInvoice" ALTER COLUMN "purchaseOrderId" DROP NOT NULL;
ALTER TABLE "PurchaseOrderInvoice" ADD COLUMN "documentId" TEXT;

CREATE INDEX "PurchaseOrderInvoice_documentId_uploadedAt_idx" ON "PurchaseOrderInvoice"("documentId", "uploadedAt");

ALTER TABLE "PurchaseOrderInvoice"
  ADD CONSTRAINT "PurchaseOrderInvoice_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrderInvoice"
  ADD CONSTRAINT "PurchaseOrderInvoice_one_parent_check"
  CHECK (("purchaseOrderId" IS NOT NULL) <> ("documentId" IS NOT NULL));