-- MenuItemIngredient is looked up inside a held DB transaction on every bill
-- creation and every running-order close (auto stock-deduction) — the
-- hottest checkout-path query in the app, previously with zero index
-- coverage (Postgres does not auto-index foreign keys).
CREATE INDEX "MenuItemIngredient_menuItemId_idx" ON "MenuItemIngredient"("menuItemId");
CREATE INDEX "MenuItemIngredient_ingredientId_idx" ON "MenuItemIngredient"("ingredientId");

-- Ingredient is filtered by restaurantId on nearly every read (list,
-- reorder-alert scan, vendor-catalog-import dedup) with zero index coverage.
CREATE INDEX "Ingredient_restaurantId_idx" ON "Ingredient"("restaurantId");
CREATE INDEX "Ingredient_restaurantId_categoryId_idx" ON "Ingredient"("restaurantId", "categoryId");

-- ShopExpense/DailyCashSession are filtered by their own date column the
-- same way Bill is filtered by createdAt, but lacked the matching index.
CREATE INDEX "ShopExpense_restaurantId_expenseDate_idx" ON "ShopExpense"("restaurantId", "expenseDate");
CREATE INDEX "DailyCashSession_branchId_businessDate_idx" ON "DailyCashSession"("branchId", "businessDate");
