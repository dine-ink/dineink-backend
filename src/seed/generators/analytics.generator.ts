import type { SeedConfig } from "../config";
import type { SeedContext } from "../context";
import { type Db, isWeekend } from "../utils";

export interface AnalyticsValidationReport {
  referenceMonthLabel: string;
  totalRevenue: number;
  referenceMonthRevenue: number;
  foodCostPct: number;
  primeCostPct: number;
  ebitdaPct: number;
  weekendVsWeekdayRevenueRatio: number;
  warnings: string[];
}

const TOLERANCE_PP = 7; // percentage points either side of the config target before it's flagged

/** The last fully-elapsed calendar month within the seeded window — avoids the partial current month distorting fixed-cost ratios (rent/salary are full-month figures; a 22-day slice of revenue would make EBITDA look artificially worse). */
function referenceMonthRange(): { start: Date; end: Date; label: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  return { start, end, label: start.toLocaleString("en-US", { month: "long", year: "numeric" }) };
}

/**
 * Owns no Prisma model of its own — reads back what the earlier generators
 * wrote and checks it against config.analytics.* targets, appending a
 * human-readable warning for anything that drifted outside a +/-7
 * percentage-point band instead of failing silently. index.ts prints the
 * returned report.
 *
 * Food cost / prime cost / EBITDA are computed for the last FULLY elapsed
 * calendar month in the window (not an all-time or partial-current-month
 * figure) — mirrors a real gotcha found in analytics.service.ts itself
 * (getRestaurantInsightsData's own comment: scoping revenue to the current
 * calendar month, because RestaurantInsights' fixed/variable costs are
 * monthly figures and an all-time revenue sum would make every ratio look
 * better the longer the restaurant has been open). Using a full month here
 * avoids the same distortion from the other direction — a ~22-day slice of
 * revenue compared against a full month of rent/salary.
 *
 * Food cost = recipe-based ingredient cost of what was actually sold that
 * month (Σ BillItem.quantity x MenuItemIngredient.quantity x Ingredient.
 * pricePerUnit), not vendor invoice spend — those measure different things
 * (cost of goods sold vs. cash spent restocking) and no formula for either
 * was found anywhere in this backend (search suggests the P&L math lives in
 * a frontend this repo doesn't contain), so both are my own standard
 * restaurant-accounting definitions, not a replication of app code.
 * Prime cost = food cost + base staff salaries (overtime pay excluded for
 * simplicity). EBITDA = revenue - food cost - salaries - that month's
 * ShopExpense ledger.
 */
export async function validateAnalytics(db: Db, config: SeedConfig, ctx: SeedContext): Promise<AnalyticsValidationReport> {
  const { start, end, label } = referenceMonthRange();
  const warnings: string[] = [];

  const [totalRevenueAgg, referenceMonthRevenueAgg, referenceMonthBillItems, referenceMonthExpenses, allBills] = await Promise.all([
    db.bill.aggregate({ where: { restaurantId: ctx.restaurant.id }, _sum: { total: true } }),
    db.bill.aggregate({
      where: { restaurantId: ctx.restaurant.id, createdAt: { gte: start, lte: end } },
      _sum: { total: true },
    }),
    db.billItem.findMany({
      where: { bill: { restaurantId: ctx.restaurant.id, createdAt: { gte: start, lte: end } }, menuItemId: { not: null } },
      select: { menuItemId: true, quantity: true },
    }),
    db.shopExpense.aggregate({
      where: { restaurantId: ctx.restaurant.id, expenseDate: { gte: start, lte: end } },
      _sum: { amount: true },
    }),
    db.bill.findMany({ where: { restaurantId: ctx.restaurant.id }, select: { total: true, createdAt: true } }),
  ]);

  const totalRevenue = totalRevenueAgg._sum.total ?? 0;
  const referenceMonthRevenue = referenceMonthRevenueAgg._sum.total ?? 0;

  const ingredientPriceById = new Map(ctx.ingredients.map((i) => [i.id, i.pricePerUnit ?? 0]));
  const costByMenuItem = new Map<number, number>();
  for (const recipe of ctx.menuItemIngredients) {
    const unitCost = recipe.quantity * (ingredientPriceById.get(recipe.ingredientId) ?? 0);
    costByMenuItem.set(recipe.menuItemId, (costByMenuItem.get(recipe.menuItemId) ?? 0) + unitCost);
  }
  const foodCost = referenceMonthBillItems.reduce(
    (sum, item) => sum + (costByMenuItem.get(item.menuItemId!) ?? 0) * item.quantity,
    0,
  );

  const laborCost = ctx.branches.flatMap((b) => b.staff).reduce((sum, u) => sum + (u.salary ?? 0), 0);
  const operatingExpenses = referenceMonthExpenses._sum.amount ?? 0;

  const ebitda = referenceMonthRevenue - foodCost - laborCost - operatingExpenses;
  const foodCostPct = referenceMonthRevenue > 0 ? foodCost / referenceMonthRevenue : 0;
  const primeCostPct = referenceMonthRevenue > 0 ? (foodCost + laborCost) / referenceMonthRevenue : 0;
  const ebitdaPct = referenceMonthRevenue > 0 ? ebitda / referenceMonthRevenue : 0;

  const weekendDays = new Set<string>();
  const weekdayDays = new Set<string>();
  let weekendRevenue = 0;
  let weekdayRevenue = 0;
  for (const bill of allBills) {
    const dateKey = bill.createdAt.toISOString().slice(0, 10);
    if (isWeekend(bill.createdAt)) {
      weekendRevenue += bill.total;
      weekendDays.add(dateKey);
    } else {
      weekdayRevenue += bill.total;
      weekdayDays.add(dateKey);
    }
  }
  const weekendPerDay = weekendDays.size > 0 ? weekendRevenue / weekendDays.size : 0;
  const weekdayPerDay = weekdayDays.size > 0 ? weekdayRevenue / weekdayDays.size : 0;
  const weekendVsWeekdayRevenueRatio = weekdayPerDay > 0 ? weekendPerDay / weekdayPerDay : 0;

  const checkTarget = (name: string, actualPct: number, targetPct: number) => {
    const diffPP = Math.abs(actualPct * 100 - targetPct * 100);
    if (diffPP > TOLERANCE_PP) {
      warnings.push(
        `${name}: ${(actualPct * 100).toFixed(1)}% is ${diffPP.toFixed(1)}pp away from the ${(targetPct * 100).toFixed(0)}% target (tolerance +/-${TOLERANCE_PP}pp)`,
      );
    }
  };
  checkTarget("Food cost", foodCostPct, config.analytics.targetFoodCostPct);
  checkTarget("Prime cost", primeCostPct, config.analytics.targetPrimeCostPct);
  checkTarget("EBITDA", ebitdaPct, config.analytics.targetEbitdaPct);
  if (weekendVsWeekdayRevenueRatio < 1.1) {
    warnings.push(
      `Weekend revenue/day (₹${weekendPerDay.toFixed(0)}) isn't meaningfully outperforming weekday (₹${weekdayPerDay.toFixed(0)}) — ratio ${weekendVsWeekdayRevenueRatio.toFixed(2)}`,
    );
  }

  return {
    referenceMonthLabel: label,
    totalRevenue,
    referenceMonthRevenue,
    foodCostPct,
    primeCostPct,
    ebitdaPct,
    weekendVsWeekdayRevenueRatio,
    warnings,
  };
}
