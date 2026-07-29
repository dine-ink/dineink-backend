// Budget vs Actual — CRUD for Budget/BudgetItem plus the Variance Engine.
// Actuals are NEVER computed independently here: every one comes from
// computePeriodMetrics/computeFinancialMetrics (finance.formulas.ts, the
// same functions the Financial Summary, Ratio Engine, and Statements use) or
// a direct proration of RestaurantInsights via the already-exported
// prorateMonthly — there is no second calculation path in this file.
import prisma from "../../config/prisma";
import { DateRange, PeriodKey, daysInRange, getComparisonPeriod, resolveDateRange } from "../../utils/dateRange";
import { computeVariance } from "../finance/finance.formulas";
import { computeAchievement } from "../finance/finance.ratios";
import { fetchInsightsForScope, getMenuItemCostMap, resolveScopedMetrics, ScopedFinancialBundle } from "../finance/finance.service";
import { BUDGET_CATEGORIES, BudgetItemInput, BudgetVarianceReport, BudgetVarianceRow } from "./budget.types";
import { ValidationError } from "./budget.validation";

// ── CRUD ──────────────────────────────────────────────────────────────────

export const createBudgetService = async (
  restaurantId: number,
  payload: { branchId: number | null; financialYear: string; name: string; notes: string | null; monthlyDefaults: Record<string, number> },
  createdById?: number,
) => {
  const fyStartYear = Number(payload.financialYear);
  // Indian FY: Apr (fyStartYear) through Mar (fyStartYear + 1), matching InvoiceSequence's convention.
  const months: { year: number; month: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const m = ((3 + i) % 12) + 1; // 4,5,...,12,1,2,3
    const y = m >= 4 ? fyStartYear : fyStartYear + 1;
    months.push({ year: y, month: m });
  }

  const itemsData = Object.entries(payload.monthlyDefaults).flatMap(([category, monthlyAmount]) =>
    months.map(({ year, month }) => ({ category, year, month, amount: monthlyAmount })),
  );

  return prisma.budget.create({
    data: {
      restaurantId,
      branchId: payload.branchId,
      financialYear: payload.financialYear,
      name: payload.name,
      notes: payload.notes,
      createdById,
      updatedById: createdById,
      items: { create: itemsData },
    },
    include: { items: true },
  });
};

export const listBudgetsService = async (
  restaurantId: number,
  filters: { branchId?: number; financialYear?: string; status?: string },
) => {
  return prisma.budget.findMany({
    where: {
      restaurantId,
      ...(filters.branchId !== undefined ? { branchId: filters.branchId } : {}),
      ...(filters.financialYear ? { financialYear: filters.financialYear } : {}),
      ...(filters.status ? { status: filters.status as any } : {}),
    },
    include: { branch: { select: { id: true, name: true } }, _count: { select: { items: true } } },
    orderBy: [{ financialYear: "desc" }, { createdAt: "desc" }],
  });
};

const findOwnedBudget = async (restaurantId: number, budgetId: number) => {
  const budget = await prisma.budget.findUnique({ where: { id: budgetId }, include: { items: true } });
  if (!budget || budget.restaurantId !== restaurantId) {
    throw new ValidationError("Budget not found");
  }
  return budget;
};

export const getBudgetService = async (restaurantId: number, budgetId: number) => findOwnedBudget(restaurantId, budgetId);

export const updateBudgetService = async (
  restaurantId: number,
  budgetId: number,
  payload: { name?: string; notes?: string | null; status?: string },
  updatedById?: number,
) => {
  await findOwnedBudget(restaurantId, budgetId);
  return prisma.budget.update({
    where: { id: budgetId },
    data: { ...payload, status: payload.status as any, updatedById },
    include: { items: true },
  });
};

export const upsertBudgetItemsService = async (restaurantId: number, budgetId: number, items: BudgetItemInput[], updatedById?: number) => {
  await findOwnedBudget(restaurantId, budgetId);

  await prisma.$transaction([
    ...items.map((item) =>
      prisma.budgetItem.upsert({
        where: { budgetId_category_year_month: { budgetId, category: item.category, year: item.year, month: item.month } },
        update: { amount: item.amount, notes: item.notes },
        create: { budgetId, category: item.category, year: item.year, month: item.month, amount: item.amount, notes: item.notes },
      }),
    ),
    prisma.budget.update({ where: { id: budgetId }, data: { updatedById } }),
  ]);

  return findOwnedBudget(restaurantId, budgetId);
};

export const duplicateBudgetService = async (
  restaurantId: number,
  budgetId: number,
  overrides: { name?: string; financialYear?: string; branchId?: number | null },
  createdById?: number,
) => {
  const source = await findOwnedBudget(restaurantId, budgetId);
  const yearDelta = overrides.financialYear ? Number(overrides.financialYear) - Number(source.financialYear) : 0;

  return prisma.budget.create({
    data: {
      restaurantId,
      branchId: overrides.branchId !== undefined ? overrides.branchId : source.branchId,
      financialYear: overrides.financialYear ?? source.financialYear,
      name: overrides.name ?? `${source.name} (Copy)`,
      notes: source.notes,
      createdById,
      updatedById: createdById,
      items: {
        create: source.items.map((item) => ({
          category: item.category,
          year: item.year + yearDelta,
          month: item.month,
          amount: item.amount,
          notes: item.notes,
        })),
      },
    },
    include: { items: true },
  });
};

// ── Variance Engine ─────────────────────────────────────────────────────────

const floorToMidnight = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/** Whole days of overlap between a calendar month and a date range — floored to midnight before diffing (same fix as utils/dateRange.ts's daysInRange). */
const monthOverlapDays = (year: number, month: number, range: DateRange): number => {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
  const overlapStart = floorToMidnight(monthStart > range.startDate ? monthStart : range.startDate);
  const overlapEnd = floorToMidnight(monthEnd < range.endDate ? monthEnd : range.endDate);
  if (overlapStart > overlapEnd) return 0;
  return Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 86_400_000) + 1;
};

const daysInCalendarMonth = (year: number, month: number): number => new Date(year, month, 0).getDate();

/**
 * Aggregates a category's BudgetItems onto a requested date range. Currency/
 * count categories sum each overlapping month's amount, prorated by how many
 * of that month's days actually fall in range (so a custom mid-month range
 * doesn't double-count a whole month's budget). Percentage categories are
 * day-weighted-averaged instead of summed — averaging "Food Cost % budget"
 * across 3 months is the correct aggregate, not their sum.
 */
export const aggregateBudgetForCategory = (
  items: { category: string; year: number; month: number; amount: number }[],
  category: string,
  range: DateRange,
  unit: "currency" | "percentage" | "count",
): number | null => {
  const matches = items.filter((i) => i.category === category);
  let weightedTotal = 0;
  let totalDays = 0;
  let any = false;

  for (const item of matches) {
    const overlapDays = monthOverlapDays(item.year, item.month, range);
    if (overlapDays <= 0) continue;
    any = true;
    if (unit === "percentage") {
      weightedTotal += item.amount * overlapDays;
      totalDays += overlapDays;
    } else {
      const monthDays = daysInCalendarMonth(item.year, item.month);
      weightedTotal += item.amount * (overlapDays / monthDays);
    }
  }

  if (!any) return null;
  return unit === "percentage" ? (totalDays > 0 ? Math.round((weightedTotal / totalDays) * 10) / 10 : null) : Math.round(weightedTotal);
};

const actualFor = (category: string, bundle: ScopedFinancialBundle): number | null => {
  switch (category) {
    case "revenue": return bundle.metrics.revenue;
    case "orders": return bundle.metrics.orders;
    case "avgOrderValue": return Math.round(bundle.metrics.avgOrderValue);
    case "foodCost": return bundle.metrics.foodCost;
    case "foodCostPercentage": return bundle.metrics.foodCostPercentage;
    case "primeCost": return bundle.metrics.primeCost;
    case "labour": return bundle.metrics.labourCost;
    case "labourPercentage": return bundle.metrics.labourCostPercentage;
    case "rent": return bundle.rent;
    case "utilities": return bundle.utilities;
    case "marketing": return bundle.marketing;
    case "maintenance": return bundle.maintenance;
    case "cleaning": return null;
    case "packaging": return bundle.packaging;
    case "deliveryCommission": return bundle.deliveryCommission;
    case "operatingExpenses": return bundle.metrics.labourCost + bundle.metrics.fixedExpenses + bundle.metrics.variableExpenses;
    case "ebitda": return bundle.metrics.ebitda;
    case "netProfit": return bundle.metrics.netProfit;
    case "cashFlow": return null;
    default: return null;
  }
};

export const statusFor = (achievementPercentage: number | null): BudgetVarianceRow["status"] => {
  if (achievementPercentage === null) return "no-data";
  if (achievementPercentage >= 100) return "on-track";
  if (achievementPercentage >= 90) return "warning";
  return "critical";
};

export const getBudgetVarianceService = async (
  restaurantId: number,
  budgetId: number,
  period: PeriodKey,
  from?: string,
  to?: string,
): Promise<BudgetVarianceReport> => {
  const budget = await findOwnedBudget(restaurantId, budgetId);
  const range = resolveDateRange(period, from, to);
  const previousRange = getComparisonPeriod(period, range);

  // Fetched once per request (not once per period) — menu costs and
  // RestaurantInsights are both date-range-independent, so reusing them
  // across the current/previous resolveScopedMetrics calls below halves what
  // would otherwise be duplicate queries.
  const menuItemCostMap = await getMenuItemCostMap(restaurantId);
  const insightsData = await fetchInsightsForScope(restaurantId, budget.branchId);

  const [currentActuals, previousActuals] = await Promise.all([
    resolveScopedMetrics(restaurantId, budget.branchId, range, menuItemCostMap, insightsData),
    resolveScopedMetrics(restaurantId, budget.branchId, previousRange, menuItemCostMap, insightsData),
  ]);

  const rows: BudgetVarianceRow[] = BUDGET_CATEGORIES.map((def) => {
    const budgetValue = aggregateBudgetForCategory(budget.items, def.key, range, def.unit);
    const actual = def.actualAvailable ? actualFor(def.key, currentActuals) : null;
    const previousActual = def.actualAvailable ? actualFor(def.key, previousActuals) : null;
    const variance = computeVariance(actual, budgetValue);
    const trend = computeVariance(actual, previousActual);
    const achievementPercentage = computeAchievement(actual, budgetValue, def.higherIsBetter);

    return {
      category: def.key,
      label: def.label,
      unit: def.unit,
      budget: budgetValue,
      actual,
      variance: variance.variance,
      variancePercentage: variance.variancePercentage,
      achievementPercentage,
      status: statusFor(achievementPercentage),
      trendDirection: trend.trendDirection,
    };
  });

  return {
    budgetId,
    restaurantId,
    branchId: budget.branchId,
    period,
    startDate: range.startDate.toISOString(),
    endDate: range.endDate.toISOString(),
    rows,
  };
};
