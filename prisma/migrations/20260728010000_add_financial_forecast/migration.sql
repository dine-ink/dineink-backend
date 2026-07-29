-- CreateEnum
CREATE TYPE "ForecastPeriodType" AS ENUM ('NEXT_WEEK', 'NEXT_MONTH', 'NEXT_QUARTER', 'NEXT_6_MONTHS', 'NEXT_YEAR');

-- CreateEnum
CREATE TYPE "ForecastModelType" AS ENUM ('HISTORICAL_TREND', 'MOVING_AVERAGE', 'SEASONAL');

-- CreateTable
CREATE TABLE "FinancialForecast" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "periodType" "ForecastPeriodType" NOT NULL,
    "model" "ForecastModelType" NOT NULL,
    "targetStartDate" TIMESTAMP(3) NOT NULL,
    "targetEndDate" TIMESTAMP(3) NOT NULL,
    "predictions" JSONB NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialForecast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinancialForecast_restaurantId_idx" ON "FinancialForecast"("restaurantId");

-- CreateIndex
CREATE INDEX "FinancialForecast_branchId_idx" ON "FinancialForecast"("branchId");

-- CreateIndex
CREATE INDEX "FinancialForecast_restaurantId_periodType_idx" ON "FinancialForecast"("restaurantId", "periodType");

-- CreateIndex
CREATE INDEX "FinancialForecast_targetEndDate_idx" ON "FinancialForecast"("targetEndDate");

-- AddForeignKey
ALTER TABLE "FinancialForecast" ADD CONSTRAINT "FinancialForecast_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialForecast" ADD CONSTRAINT "FinancialForecast_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialForecast" ADD CONSTRAINT "FinancialForecast_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
