-- CreateEnum
CREATE TYPE "ScenarioType" AS ENUM ('CONSERVATIVE', 'EXPECTED', 'OPTIMISTIC', 'CUSTOM');

-- CreateTable
CREATE TABLE "FinancialScenario" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "ScenarioType" NOT NULL DEFAULT 'CUSTOM',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "revenueGrowthPercentage" DOUBLE PRECISION,
    "orderGrowthPercentage" DOUBLE PRECISION,
    "avgOrderValue" DOUBLE PRECISION,
    "rent" DOUBLE PRECISION,
    "utilities" DOUBLE PRECISION,
    "marketing" DOUBLE PRECISION,
    "maintenance" DOUBLE PRECISION,
    "packaging" DOUBLE PRECISION,
    "foodCostTargetPercentage" DOUBLE PRECISION,
    "labourTargetPercentage" DOUBLE PRECISION,
    "deliveryPercentage" DOUBLE PRECISION,
    "swiggyCommissionPercentage" DOUBLE PRECISION,
    "zomatoCommissionPercentage" DOUBLE PRECISION,
    "royaltyPercentage" DOUBLE PRECISION,
    "franchiseFeePercentage" DOUBLE PRECISION,
    "salaryIncrementPercentage" DOUBLE PRECISION,
    "inflationPercentage" DOUBLE PRECISION,
    "rentEscalationPercentage" DOUBLE PRECISION,
    "workingDays" INTEGER,
    "businessHours" DOUBLE PRECISION,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialScenario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinancialScenario_restaurantId_idx" ON "FinancialScenario"("restaurantId");

-- CreateIndex
CREATE INDEX "FinancialScenario_branchId_idx" ON "FinancialScenario"("branchId");

-- CreateIndex
CREATE INDEX "FinancialScenario_restaurantId_type_idx" ON "FinancialScenario"("restaurantId", "type");

-- AddForeignKey
ALTER TABLE "FinancialScenario" ADD CONSTRAINT "FinancialScenario_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialScenario" ADD CONSTRAINT "FinancialScenario_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialScenario" ADD CONSTRAINT "FinancialScenario_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialScenario" ADD CONSTRAINT "FinancialScenario_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
