-- AlterTable
-- Additive, backward-compatible: every existing row defaults to rentModel
-- = 'FIXED' with 0% revenue shares, so existing rent calculations are
-- byte-for-byte unchanged until an owner explicitly switches the toggle.
ALTER TABLE "RestaurantInsights" ADD COLUMN IF NOT EXISTS "rentModel" TEXT DEFAULT 'FIXED';
ALTER TABLE "RestaurantInsights" ADD COLUMN IF NOT EXISTS "rentSharePercentDineIn" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "RestaurantInsights" ADD COLUMN IF NOT EXISTS "rentSharePercentTakeaway" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "RestaurantInsights" ADD COLUMN IF NOT EXISTS "rentSharePercentDelivery" DOUBLE PRECISION DEFAULT 0;
