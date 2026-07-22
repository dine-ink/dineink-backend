-- CreateTable
CREATE TABLE "InvoiceSequence" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "financialYear" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceSequence_branchId_financialYear_key" ON "InvoiceSequence"("branchId", "financialYear");

-- CreateIndex
CREATE INDEX "InvoiceSequence_restaurantId_idx" ON "InvoiceSequence"("restaurantId");
