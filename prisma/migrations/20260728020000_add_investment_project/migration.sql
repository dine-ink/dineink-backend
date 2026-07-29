-- CreateEnum
CREATE TYPE "InvestmentType" AS ENUM ('NEW_BRANCH', 'BRANCH_EXPANSION', 'KITCHEN_UPGRADE', 'EQUIPMENT_PURCHASE', 'INTERIOR_RENOVATION', 'DELIVERY_EXPANSION', 'MARKETING_INVESTMENT', 'FRANCHISE_OUTLET', 'CUSTOM');

-- CreateEnum
CREATE TYPE "InvestmentStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "InvestmentProject" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "name" TEXT NOT NULL,
    "type" "InvestmentType" NOT NULL DEFAULT 'CUSTOM',
    "description" TEXT,
    "status" "InvestmentStatus" NOT NULL DEFAULT 'PLANNED',
    "initialInvestment" DOUBLE PRECISION NOT NULL,
    "plannedStartDate" TIMESTAMP(3) NOT NULL,
    "expectedCompletionDate" TIMESTAMP(3),
    "projectLifeYears" INTEGER NOT NULL DEFAULT 5,
    "discountRate" DOUBLE PRECISION,
    "inflationRate" DOUBLE PRECISION,
    "monthlyRevenueIncrease" DOUBLE PRECISION,
    "revenueGrowthPercentage" DOUBLE PRECISION,
    "expectedCostSavings" DOUBLE PRECISION,
    "labourSavings" DOUBLE PRECISION,
    "additionalOperatingExpenses" DOUBLE PRECISION,
    "maintenanceCost" DOUBLE PRECISION,
    "salvageValue" DOUBLE PRECISION,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestmentProject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvestmentProject_restaurantId_idx" ON "InvestmentProject"("restaurantId");

-- CreateIndex
CREATE INDEX "InvestmentProject_branchId_idx" ON "InvestmentProject"("branchId");

-- CreateIndex
CREATE INDEX "InvestmentProject_restaurantId_status_idx" ON "InvestmentProject"("restaurantId", "status");

-- AddForeignKey
ALTER TABLE "InvestmentProject" ADD CONSTRAINT "InvestmentProject_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentProject" ADD CONSTRAINT "InvestmentProject_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentProject" ADD CONSTRAINT "InvestmentProject_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
