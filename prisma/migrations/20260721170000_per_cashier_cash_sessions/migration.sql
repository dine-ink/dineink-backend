-- DropIndex
-- IF EXISTS: this schema has had drift from hand-authored migrations before,
-- so don't assume the unique index was ever actually applied to this DB.
DROP INDEX IF EXISTS "DailyCashSession_restaurantId_branchId_businessDate_key";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DailyCashSession_openedById_idx" ON "DailyCashSession"("openedById");
