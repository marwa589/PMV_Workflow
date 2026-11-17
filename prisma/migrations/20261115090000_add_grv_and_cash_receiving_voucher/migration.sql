CREATE TABLE "GoodsReceivingVoucher" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT NOT NULL,
    CONSTRAINT "GoodsReceivingVoucher_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoodsReceivingVoucher_invoiceId_key" ON "GoodsReceivingVoucher"("invoiceId");
CREATE UNIQUE INDEX "GoodsReceivingVoucher_filePath_key" ON "GoodsReceivingVoucher"("filePath");
CREATE INDEX "GoodsReceivingVoucher_uploadedAt_idx" ON "GoodsReceivingVoucher"("uploadedAt");
CREATE INDEX "GoodsReceivingVoucher_uploadedById_idx" ON "GoodsReceivingVoucher"("uploadedById");

ALTER TABLE "GoodsReceivingVoucher" ADD CONSTRAINT "GoodsReceivingVoucher_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PurchaseOrderInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoodsReceivingVoucher" ADD CONSTRAINT "GoodsReceivingVoucher_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CashReceivingVoucher" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT NOT NULL,
    CONSTRAINT "CashReceivingVoucher_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CashReceivingVoucher_documentId_key" ON "CashReceivingVoucher"("documentId");
CREATE UNIQUE INDEX "CashReceivingVoucher_filePath_key" ON "CashReceivingVoucher"("filePath");
CREATE INDEX "CashReceivingVoucher_uploadedAt_idx" ON "CashReceivingVoucher"("uploadedAt");
CREATE INDEX "CashReceivingVoucher_uploadedById_idx" ON "CashReceivingVoucher"("uploadedById");

ALTER TABLE "CashReceivingVoucher" ADD CONSTRAINT "CashReceivingVoucher_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashReceivingVoucher" ADD CONSTRAINT "CashReceivingVoucher_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
