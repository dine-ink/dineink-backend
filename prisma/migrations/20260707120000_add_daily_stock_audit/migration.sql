-- CreateTable
CREATE TABLE "DailyStockAudit" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "ingredientId" INTEGER NOT NULL,
    "auditDate" TIMESTAMP(3) NOT NULL,
    "openingQty" DOUBLE PRECISION NOT NULL,
    "sopConsumed" DOUBLE PRECISION NOT NULL,
    "closingQty" DOUBLE PRECISION NOT NULL,
    "wastage" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyStockAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyStockAudit_branchId_idx" ON "DailyStockAudit"("branchId");

-- CreateIndex
CREATE INDEX "DailyStockAudit_restaurantId_idx" ON "DailyStockAudit"("restaurantId");

-- CreateIndex
CREATE INDEX "DailyStockAudit_branchId_auditDate_idx" ON "DailyStockAudit"("branchId", "auditDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyStockAudit_branchId_ingredientId_auditDate_key" ON "DailyStockAudit"("branchId", "ingredientId", "auditDate");

-- AddForeignKey
ALTER TABLE "DailyStockAudit" ADD CONSTRAINT "DailyStockAudit_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyStockAudit" ADD CONSTRAINT "DailyStockAudit_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyStockAudit" ADD CONSTRAINT "DailyStockAudit_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
