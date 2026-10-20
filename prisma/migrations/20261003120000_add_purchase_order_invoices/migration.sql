CREATE TABLE "PurchaseOrderInvoice" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT NOT NULL,
    CONSTRAINT "PurchaseOrderInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseOrderInvoice_filePath_key" ON "PurchaseOrderInvoice"("filePath");
CREATE INDEX "PurchaseOrderInvoice_purchaseOrderId_uploadedAt_idx" ON "PurchaseOrderInvoice"("purchaseOrderId", "uploadedAt");
CREATE INDEX "PurchaseOrderInvoice_uploadedById_idx" ON "PurchaseOrderInvoice"("uploadedById");

ALTER TABLE "PurchaseOrderInvoice" ADD CONSTRAINT "PurchaseOrderInvoice_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderInvoice" ADD CONSTRAINT "PurchaseOrderInvoice_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;