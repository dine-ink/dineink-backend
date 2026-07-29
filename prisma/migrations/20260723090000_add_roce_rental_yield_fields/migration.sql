-- AlterTable
-- propertyValue already existed in production (added by an earlier,
-- untracked migration) — IF NOT EXISTS makes this safe regardless of which
-- environment it runs against.
ALTER TABLE "RestaurantInsights" ADD COLUMN IF NOT EXISTS "propertyValue" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "RestaurantInsights" ADD COLUMN IF NOT EXISTS "capitalEmployed" DOUBLE PRECISION DEFAULT 0;
