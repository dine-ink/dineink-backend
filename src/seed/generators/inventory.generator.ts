import type { DailyStockAudit, Ingredient, InventoryAdjustment, InventoryRestock, Prisma } from "../../../generated/prisma";
import type { SeedConfig } from "../config";
import type { SeedContext } from "../context";
import {
  batchCreateManyAndReturn,
  chance,
  type Db,
  historyDateRange,
  historyMonths,
  pickOne,
  randomFloat,
  randomInt,
  sampleUnique,
  toUtcMidnight,
  weightedPick,
} from "../utils";

/** branchId -> "yyyy-mm-dd" -> ingredientId -> qty consumed that day. */
export type DailyIngredientConsumption = Map<number, Map<string, Map<number, number>>>;

export interface InventorySeedResult {
  restocks: InventoryRestock[];
  adjustments: InventoryAdjustment[];
}

const WEEK_KEYS = ["week1", "week2", "week3", "week4"] as const;
const DAY_COUNT = 7;

// Perishables spoil more often than shelf-stable groceries/packaging.
const PERISHABLE_CATEGORIES = new Set(["Vegetables", "Milk", "Paneer", "Cheese"]);

const ADJUSTMENT_TYPE_MIX = { WASTAGE: 0.5, DAMAGE: 0.2, EXPIRED: 0.2, MANUAL: 0.1 };
const ADJUSTMENT_REASONS: Record<string, string[]> = {
  WASTAGE: ["Spoiled during storage", "Trimming/prep wastage", "Spilled during handling"],
  DAMAGE: ["Damaged during transport", "Container burst in storage", "Dropped during unloading"],
  EXPIRED: ["Past expiry date", "Discarded — expired batch", "Quality check failure, expired"],
  MANUAL: ["Manual stock correction", "Physical count adjustment", "Recorded quantity error fixed"],
};

function buildRestockRow(ingredient: Ingredient, categoryName: string) {
  const unit = ingredient.unit || "Kg";
  const basePrice = ingredient.pricePerUnit || 1;
  const typicalWeeklyQty = Math.max(0.1, (ingredient.reorderLevel || 1) * randomFloat(0.8, 1.5));
  const openingQty = Math.round((ingredient.reorderLevel || 1) * randomFloat(1.0, 2.0) * 100) / 100;
  const closingQty = Math.round(openingQty * randomFloat(0.8, 1.3) * 100) / 100;

  const data: Record<string, unknown[]> = {};

  for (const [weekIndex, weekKey] of WEEK_KEYS.entries()) {
    const row: Record<string, unknown> = {
      Ingredient: ingredient.name,
      Category: categoryName,
      Unit: unit,
    };
    if (weekIndex === 0) {
      row["Opening Qty"] = openingQty;
      row["Opening Price"] = Math.round(basePrice * randomFloat(0.95, 1.05) * 100) / 100;
    }

    // 2-3 of the 7 days have a purchase; the rest are 0 (restocking isn't daily for most ingredients).
    const purchaseDays = new Set(sampleUnique(Array.from({ length: DAY_COUNT }, (_, i) => i + 1), randomInt(2, 3)));
    let weekPurchase = 0;
    for (let day = 1; day <= DAY_COUNT; day++) {
      const dayQty = purchaseDays.has(day) ? Math.round((typicalWeeklyQty / purchaseDays.size) * 100) / 100 : 0;
      const dayPrice = dayQty > 0 ? Math.round(basePrice * randomFloat(0.95, 1.05) * 100) / 100 : 0;
      row[`Day ${day} Qty`] = dayQty;
      row[`Day ${day} Price`] = dayPrice;
      weekPurchase += dayQty * dayPrice;
    }
    row["Week Purchase"] = Math.round(weekPurchase * 100) / 100;

    if (weekIndex === WEEK_KEYS.length - 1) {
      row["Closing Qty"] = closingQty;
    }

    data[weekKey] = [row];
  }

  return data;
}

function mergeWeeklyData(rows: Array<Record<string, unknown[]>>): Record<string, unknown[]> {
  const merged: Record<string, unknown[]> = {};
  for (const weekKey of WEEK_KEYS) {
    merged[weekKey] = rows.flatMap((r) => r[weekKey] ?? []);
  }
  return merged;
}

async function ensureRestocks(db: Db, config: SeedConfig, ctx: SeedContext): Promise<InventoryRestock[]> {
  const categoryNameById = new Map(ctx.ingredientCategories.map((c) => [c.id, c.name]));
  const rows: Prisma.InventoryRestockCreateManyInput[] = [];

  for (const branchCtx of ctx.branches) {
    for (const { month, year } of historyMonths(config.history.monthsOfHistory)) {
      const perIngredient = ctx.ingredients.map((ingredient) =>
        buildRestockRow(ingredient, (ingredient.categoryId && categoryNameById.get(ingredient.categoryId)) || "Uncategorized"),
      );
      rows.push({
        restaurantId: ctx.restaurant.id,
        branchId: branchCtx.branch.id,
        month,
        year,
        data: mergeWeeklyData(perIngredient) as Prisma.InputJsonValue,
      });
    }
  }

  return batchCreateManyAndReturn(rows, (chunk) => db.inventoryRestock.createManyAndReturn({ data: chunk }), 50);
}

async function ensureAdjustments(db: Db, config: SeedConfig, ctx: SeedContext): Promise<InventoryAdjustment[]> {
  const categoryNameById = new Map(ctx.ingredientCategories.map((c) => [c.id, c.name]));
  const rows: Prisma.InventoryAdjustmentCreateManyInput[] = [];

  for (const branchCtx of ctx.branches) {
    for (const { month, year } of historyMonths(config.history.monthsOfHistory)) {
      const daysInMonth = new Date(year, month, 0).getDate();

      for (const ingredient of ctx.ingredients) {
        const categoryName = (ingredient.categoryId && categoryNameById.get(ingredient.categoryId)) || "";
        const probability = PERISHABLE_CATEGORIES.has(categoryName) ? 0.12 : 0.04;
        if (!chance(probability)) continue;

        const adjustmentType = weightedPick(ADJUSTMENT_TYPE_MIX);
        const withUpdater = chance(0.8) && branchCtx.staff.length > 0;

        rows.push({
          restaurantId: ctx.restaurant.id,
          branchId: branchCtx.branch.id,
          ingredientId: ingredient.id,
          quantity: Math.round((ingredient.reorderLevel || 1) * randomFloat(0.02, 0.08) * 100) / 100,
          adjustmentType,
          reason: pickOne(ADJUSTMENT_REASONS[adjustmentType]),
          updatedById: withUpdater ? pickOne(branchCtx.staff).id : null,
          createdAt: new Date(year, month - 1, randomInt(1, daysInMonth)),
        });
      }
    }
  }

  return batchCreateManyAndReturn(rows, (chunk) => db.inventoryAdjustment.createManyAndReturn({ data: chunk }));
}

/**
 * Owns: InventoryRestock (one JSON summary row per branch per month —
 * shaped to match what inventory.service.ts's getIngredientLifecycleService
 * actually parses: `{ week1: [{Ingredient, Unit, "Opening Qty", "Day N Qty",
 * "Day N Price", "Closing Qty", ...}], week2: [...] }`) and
 * InventoryAdjustment (occasional DAMAGE/WASTAGE/EXPIRED/MANUAL
 * corrections — perishables like Vegetables/Milk/Paneer/Cheese spoil more
 * often than shelf-stable goods).
 *
 * Deliberately does NOT include "SALE_DEDUCTION" adjustments — those are
 * auto-logged per paid bill by the real app (see bill.service.ts /
 * runningOrder.service.ts), so bill.generator.ts (Phase 7) creates them
 * alongside each Bill instead of this generator guessing at them ahead of
 * time. DailyStockAudit is also NOT here despite the original file mapping
 * suggesting it — its sopConsumed is defined as "Σ(billItem.qty ×
 * recipe.qty)" (see schema comment), which needs real Bill/BillItem rows to
 * exist first, so it's generated in Phase 7 after bills, not here.
 *
 * Idempotent: generates once per restaurant, checked via a plain count().
 */
export async function generateInventoryActivity(db: Db, config: SeedConfig, ctx: SeedContext): Promise<InventorySeedResult> {
  const existingCount = await db.inventoryRestock.count({ where: { restaurantId: ctx.restaurant.id } });
  if (existingCount > 0) {
    const [restocks, adjustments] = await Promise.all([
      db.inventoryRestock.findMany({ where: { restaurantId: ctx.restaurant.id } }),
      db.inventoryAdjustment.findMany({ where: { restaurantId: ctx.restaurant.id } }),
    ]);
    return { restocks, adjustments };
  }

  const restocks = await ensureRestocks(db, config, ctx);
  const adjustments = await ensureAdjustments(db, config, ctx);
  return { restocks, adjustments };
}

/**
 * Fallback path: if generateDailyStockAudits() is ever called without the
 * in-memory consumption map bill.generator.ts normally hands it (e.g. bills
 * already existed from an earlier, interrupted run), re-derive the same
 * numbers from BillItem x MenuItemIngredient directly. Not the common path —
 * a one-time, heavier query over every historical bill item.
 */
async function deriveConsumptionFromDb(db: Db, ctx: SeedContext): Promise<DailyIngredientConsumption> {
  const recipeByMenuItemId = new Map<number, { ingredientId: number; quantity: number }[]>();
  for (const recipe of ctx.menuItemIngredients) {
    recipeByMenuItemId.set(recipe.menuItemId, [
      ...(recipeByMenuItemId.get(recipe.menuItemId) ?? []),
      { ingredientId: recipe.ingredientId, quantity: recipe.quantity },
    ]);
  }

  const billItems = await db.billItem.findMany({
    where: { bill: { restaurantId: ctx.restaurant.id }, menuItemId: { not: null } },
    select: { menuItemId: true, quantity: true, createdAt: true, bill: { select: { branchId: true } } },
  });

  const consumption: DailyIngredientConsumption = new Map();
  for (const item of billItems) {
    if (item.menuItemId == null || item.bill.branchId == null) continue;
    const recipe = recipeByMenuItemId.get(item.menuItemId);
    if (!recipe) continue;
    const branchId = item.bill.branchId;
    const dateKey = item.createdAt.toISOString().slice(0, 10);
    const branchMap = consumption.get(branchId) ?? new Map<string, Map<number, number>>();
    const dayMap = branchMap.get(dateKey) ?? new Map<number, number>();
    for (const r of recipe) {
      dayMap.set(r.ingredientId, (dayMap.get(r.ingredientId) ?? 0) + r.quantity * item.quantity);
    }
    branchMap.set(dateKey, dayMap);
    consumption.set(branchId, branchMap);
  }
  return consumption;
}

/**
 * Owns: DailyStockAudit. Runs in Phase 7 (after bill.generator.ts), NOT
 * Phase 6, because sopConsumed is defined (per the schema comment) as
 * "Σ(billItem.qty × recipe.qty)" — it needs real Bill/BillItem data.
 *
 * Scope: only the perishable ingredient categories (Vegetables, Milk,
 * Paneer, Cheese) get a daily audit — real kitchens physically count
 * perishables often and don't re-count all 200 ingredients (incl.
 * packaging/cleaning supplies) every single day; auditing the full catalog
 * daily would also be ~55k rows for marginal realism benefit. openingQty
 * chains day-to-day (each day's closingQty becomes the next day's
 * openingQty), seeded from the ingredient's live `quantity` on the first
 * audited day.
 *
 * Idempotent: generates once per restaurant, checked via a plain count().
 */
export async function generateDailyStockAudits(
  db: Db,
  config: SeedConfig,
  ctx: SeedContext,
  consumption?: DailyIngredientConsumption,
): Promise<DailyStockAudit[]> {
  const existingCount = await db.dailyStockAudit.count({ where: { restaurantId: ctx.restaurant.id } });
  if (existingCount > 0) {
    return db.dailyStockAudit.findMany({ where: { restaurantId: ctx.restaurant.id } });
  }

  const consumptionMap = consumption && consumption.size > 0 ? consumption : await deriveConsumptionFromDb(db, ctx);

  const categoryNameById = new Map(ctx.ingredientCategories.map((c) => [c.id, c.name]));
  const perishableIngredients = ctx.ingredients.filter((i) => {
    const name = i.categoryId ? categoryNameById.get(i.categoryId) : undefined;
    return name ? PERISHABLE_CATEGORIES.has(name) : false;
  });

  const days = historyDateRange(config.history.monthsOfHistory);
  const rows: Prisma.DailyStockAuditCreateManyInput[] = [];

  for (const branchCtx of ctx.branches) {
    const branchConsumption = consumptionMap.get(branchCtx.branch.id);

    for (const ingredient of perishableIngredients) {
      let openingQty = ingredient.quantity ?? 0;

      for (const day of days) {
        const dateKey = day.toISOString().slice(0, 10);
        const sopConsumed = Math.round((branchConsumption?.get(dateKey)?.get(ingredient.id) ?? 0) * 1000) / 1000;
        const wastageNoise = Math.round(openingQty * randomFloat(0, 0.03) * 1000) / 1000;
        const rawClosing = openingQty - sopConsumed - wastageNoise;
        const closingQty = Math.round(Math.max(0, rawClosing) * 1000) / 1000;
        const wastage = Math.round(Math.max(0, openingQty - sopConsumed - closingQty) * 1000) / 1000;

        rows.push({
          restaurantId: ctx.restaurant.id,
          branchId: branchCtx.branch.id,
          ingredientId: ingredient.id,
          auditDate: toUtcMidnight(day),
          openingQty: Math.round(openingQty * 1000) / 1000,
          sopConsumed,
          closingQty,
          wastage,
          notes: rawClosing < 0 ? "Consumption exceeded tracked opening stock — reconcile with next restock" : null,
        });

        openingQty = closingQty;
      }
    }
  }

  return batchCreateManyAndReturn(rows, (chunk) => db.dailyStockAudit.createManyAndReturn({ data: chunk }));
}
