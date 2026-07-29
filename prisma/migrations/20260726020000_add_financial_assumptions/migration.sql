-- CreateTable
CREATE TABLE "FinancialAssumptions" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "rentPerSqFt" DOUBLE PRECISION,
    "camPerSqFt" DOUBLE PRECISION,
    "chargeableAreaSqFt" DOUBLE PRECISION,
    "foodCostTargetPercentage" DOUBLE PRECISION,
    "labourTargetPercentage" DOUBLE PRECISION,
    "primeCostTargetPercentage" DOUBLE PRECISION,
    "ebitdaTargetPercentage" DOUBLE PRECISION,
    "occupancyTargetPercentage" DOUBLE PRECISION,
    "utilityTargetPercentage" DOUBLE PRECISION,
    "deliveryPercentage" DOUBLE PRECISION,
    "swiggyCommissionPercentage" DOUBLE PRECISION,
    "zomatoCommissionPercentage" DOUBLE PRECISION,
    "franchiseFeePercentage" DOUBLE PRECISION,
    "royaltyPercentage" DOUBLE PRECISION,
    "marketingFeePercentage" DOUBLE PRECISION,
    "salaryIncrementPercentage" DOUBLE PRECISION,
    "rentEscalationPercentage" DOUBLE PRECISION,
    "inflationPercentage" DOUBLE PRECISION,
    "gstPercentage" DOUBLE PRECISION,
    "workingDays" INTEGER,
    "businessHours" DOUBLE PRECISION,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialAssumptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinancialAssumptions_restaurantId_branchId_key" ON "FinancialAssumptions"("restaurantId", "branchId");

-- CreateIndex
CREATE INDEX "FinancialAssumptions_restaurantId_idx" ON "FinancialAssumptions"("restaurantId");

-- CreateIndex
CREATE INDEX "FinancialAssumptions_branchId_idx" ON "FinancialAssumptions"("branchId");

-- AddForeignKey
ALTER TABLE "FinancialAssumptions" ADD CONSTRAINT "FinancialAssumptions_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAssumptions" ADD CONSTRAINT "FinancialAssumptions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAssumptions" ADD CONSTRAINT "FinancialAssumptions_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
