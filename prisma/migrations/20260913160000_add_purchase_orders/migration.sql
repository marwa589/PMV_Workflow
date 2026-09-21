CREATE TABLE "PurchaseOrderSequence" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PurchaseOrderSequence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT NOT NULL,
    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseOrderMrLink" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    CONSTRAINT "PurchaseOrderMrLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");
CREATE UNIQUE INDEX "PurchaseOrder_filePath_key" ON "PurchaseOrder"("filePath");
CREATE INDEX "PurchaseOrder_uploadedById_idx" ON "PurchaseOrder"("uploadedById");
CREATE INDEX "PurchaseOrder_uploadedAt_idx" ON "PurchaseOrder"("uploadedAt");
CREATE UNIQUE INDEX "PurchaseOrderMrLink_purchaseOrderId_documentId_key" ON "PurchaseOrderMrLink"("purchaseOrderId", "documentId");
CREATE INDEX "PurchaseOrderMrLink_documentId_idx" ON "PurchaseOrderMrLink"("documentId");
CREATE INDEX "PurchaseOrderMrLink_createdById_idx" ON "PurchaseOrderMrLink"("createdById");

ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderMrLink" ADD CONSTRAINT "PurchaseOrderMrLink_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderMrLink" ADD CONSTRAINT "PurchaseOrderMrLink_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderMrLink" ADD CONSTRAINT "PurchaseOrderMrLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
