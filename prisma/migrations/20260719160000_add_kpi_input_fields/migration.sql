-- AlterTable
ALTER TABLE "Branch" ADD COLUMN "areaSqFt" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "RestaurantInsights" ADD COLUMN "marketingSpend" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "RestaurantInsights" ADD COLUMN "initialInvestment" DOUBLE PRECISION DEFAULT 0;
