// Executive Dashboard & KPI Scorecards — a pure composition layer over the
// existing Finance/Budget/Scenario/Forecast/Investment engines. No financial
// formula is re-derived anywhere in this file: every KPI value comes from
// resolveScopedMetrics/computeVariance/computeAchievement (Finance Engine),
// getBudgetVarianceService (Budget Engine), generateForecastService/
// getForecastAccuracyReportService (Forecast Engine), getPortfolioSummaryService/
// rankBranchInvestmentsService (Investment Engine), or getBranchComparisonService
// (existing analytics module, reused as-is for customer/staff metrics it
// already computes). The only genuinely new calculation is the Business
// Health Score (executive.formulas.ts) — everything else here is
// orchestration: which existing calls to make, and how to combine their
// already-computed outputs into one executive view.
import prisma from "../../config/prisma";
import {
  DateRange,
  endOfDay,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  getComparisonPeriod,
  PeriodKey,
  resolveDateRange,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from "../../utils/dateRange";
import { getBudgetVarianceService, listBudgetsService } from "../budget/budget.service";
import { computeVariance } from "../finance/finance.formulas";
import { computeAchievement } from "../finance/finance.ratios";
import { fetchInsightsForScope, getMenuItemCostMap, getPayrollPolicyMap, resolveScopedMetrics, RestaurantInsightsRow, BranchPayrollPolicy } from "../finance/finance.service";
import { getRestaurantDefaultsService, getResolvedAssumptionsService } from "../financeAssumptions/financeAssumptions.service";
import { AssumptionValues } from "../financeAssumptions/financeAssumptions.types";
import { generateForecastService, getForecastAccuracyReportService } from "../forecast/forecast.service";
import { getPortfolioSummaryService, rankBranchInvestmentsService } from "../investment/investment.service";
import { listScenariosService } from "../scenario/scenario.service";
import { getBranchComparisonService } from "../analytics/branchComparison.service";
import { computeBusinessHealthScore, DEFAULT_HEALTH_WEIGHTS, statusForScore } from "./executive.formulas";
import { BusinessHealthScoreResult, CategoryStatus, ExecutiveAlert, HealthCategoryInput, KpiScorecardRow } from "./executive.types";
import { ValidationError } from "./executive.validation";

// Same fix already established in Phase 1/2 (date-string slicing via
// toISOString() shifts calendar boundaries back a day under IST) — always
// build "YYYY-MM-DD" from local date components when handing a date string
// to an endpoint that parses it as a bare calendar date (branchComparison.service.ts).
const localDateStr = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const HIGHER_IS_BETTER: Record<string, boolean> = {
  revenue: true, orders: true, avgOrderValue: true, grossProfit: true, grossProfitMarginPercentage: true,
  ebitda: true, ebitdaPercentage: true, netProfit: true, foodCostPercentage: false, labourCostPercentage: false,
  primeCostPercentage: false, customerGrowthPercentage: true, repeatCustomerRate: true, branchCount: true,
  activeEmployees: true, inventoryValue: true, cashPosition: true,
};

const nativeTargetFor = (kpiKey: string, assumptions: AssumptionValues, insights: RestaurantInsightsRow | null): number | null => {
  switch (kpiKey) {
    case "revenue": return insights?.monthlyRevenueGoal ?? null;
    case "foodCostPercentage": return assumptions.foodCostTargetPercentage;
    case "labourCostPercentage": return assumptions.labourTargetPercentage;
    case "primeCostPercentage": return assumptions.primeCostTargetPercentage;
    case "ebitdaPercentage": return assumptions.ebitdaTargetPercentage;
    case "grossProfitMarginPercentage": return insights?.targetGrossMargin ?? null;
    case "netProfit": return insights?.monthlyProfitGoal ?? null;
    default: return null;
  }
};

const isSingleBranchInsights = (
  insightsData: Awaited<ReturnType<typeof fetchInsightsForScope>>,
): insightsData is RestaurantInsightsRow => insightsData === null || !("branchIds" in (insightsData as object));

// ── KPI Target customization (two-tier restaurant-default/branch-override, mirroring FinancialAssumptions) ──

export const resolveKpiTargetService = async (restaurantId: number, branchId: number | null, kpiKey: string, nativeValue: number | null): Promise<number | null> => {
  if (branchId !== null) {
    const branchOverride = await prisma.executiveKpiTarget.findUnique({ where: { restaurantId_branchId_kpiKey: { restaurantId, branchId, kpiKey } } });
    if (branchOverride) return branchOverride.targetValue;
  }
  // Prisma's compound-unique WhereUniqueInput type doesn't accept null for a
  // nullable member field — the same reason FinancialAssumptions' own
  // restaurant-default lookup uses findFirst instead of the compound key
  // (see financeAssumptions.service.ts's getRestaurantDefaultsService).
  const restaurantDefault = await prisma.executiveKpiTarget.findFirst({ where: { restaurantId, branchId: null, kpiKey } });
  if (restaurantDefault) return restaurantDefault.targetValue;
  return nativeValue;
};

/**
 * Batched equivalent of resolveKpiTargetService for getExecutiveOverviewService's
 * 17-row KPI fan-out — one findMany instead of up to 34 sequential calls
 * (1-2 per row). resolveKpiTargetService itself is left unchanged (still used
 * directly for single-KPI resolution elsewhere), this is purely an additive,
 * same-precedence-rule batched version for the one call site that needs many
 * KPI targets at once.
 */
const resolveKpiTargetsBatch = async (
  restaurantId: number,
  branchId: number | null,
  rows: { key: string; nativeTarget: number | null }[],
): Promise<Map<string, number | null>> => {
  const targets = await prisma.executiveKpiTarget.findMany({
    where: {
      restaurantId,
      OR: branchId !== null ? [{ branchId: null }, { branchId }] : [{ branchId: null }],
    },
  });
  const branchOverrides = new Map(
    branchId !== null ? targets.filter((t) => t.branchId === branchId).map((t) => [t.kpiKey, t.targetValue] as const) : [],
  );
  const restaurantDefaults = new Map(targets.filter((t) => t.branchId === null).map((t) => [t.kpiKey, t.targetValue] as const));
  return new Map(rows.map(({ key, nativeTarget }) => [key, branchOverrides.get(key) ?? restaurantDefaults.get(key) ?? nativeTarget]));
};

/** Upserts a KPI target — find-then-update-or-create for the restaurant-default (branchId null) case, matching upsertRestaurantDefaultsService's exact pattern (no DB constraint enforces "one default row per KPI"); the DB-enforced compound key for a real branch override. */
export const setKpiTargetService = async (restaurantId: number, branchId: number | null, kpiKey: string, targetValue: number, updatedById?: number) => {
  if (branchId === null) {
    const existing = await prisma.executiveKpiTarget.findFirst({ where: { restaurantId, branchId: null, kpiKey } });
    return existing
      ? prisma.executiveKpiTarget.update({ where: { id: existing.id }, data: { targetValue, updatedById } })
      : prisma.executiveKpiTarget.create({ data: { restaurantId, branchId: null, kpiKey, targetValue, updatedById } });
  }
  return prisma.executiveKpiTarget.upsert({
    where: { restaurantId_branchId_kpiKey: { restaurantId, branchId, kpiKey } },
    update: { targetValue, updatedById },
    create: { restaurantId, branchId, kpiKey, targetValue, updatedById },
  });
};

export const listKpiTargetsService = async (restaurantId: number, branchId?: number | null) =>
  prisma.executiveKpiTarget.findMany({ where: { restaurantId, ...(branchId !== undefined ? { branchId } : {}) } });

export const deleteKpiTargetService = async (restaurantId: number, branchId: number | null, kpiKey: string) => {
  await prisma.executiveKpiTarget.deleteMany({ where: { restaurantId, branchId, kpiKey } });
};

// ── Executive Overview (spec section 1) ──────────────────────────────────

export const getExecutiveOverviewService = async (restaurantId: number, branchId: number | null, period: PeriodKey, from?: string, to?: string) => {
  const range = resolveDateRange(period, from, to);
  const previousRange = getComparisonPeriod(period, range);

  const [insightsData, assumptions, menuItemCostMap, payrollPolicyMap] = await Promise.all([
    fetchInsightsForScope(restaurantId, branchId),
    branchId !== null ? getResolvedAssumptionsService(restaurantId, branchId) : getRestaurantDefaultsService(restaurantId),
    getMenuItemCostMap(restaurantId),
    getPayrollPolicyMap(restaurantId),
  ]);

  const [current, previous, branchComparisonCurrent, branchComparisonPrevious, branchCount, activeEmployees, ingredients, cashSessions] = await Promise.all([
    resolveScopedMetrics(restaurantId, branchId, range, menuItemCostMap, insightsData, payrollPolicyMap),
    resolveScopedMetrics(restaurantId, branchId, previousRange, menuItemCostMap, insightsData, payrollPolicyMap),
    getBranchComparisonService(restaurantId, localDateStr(range.startDate), localDateStr(range.endDate)),
    getBranchComparisonService(restaurantId, localDateStr(previousRange.startDate), localDateStr(previousRange.endDate)),
    prisma.branch.count({ where: { restaurantId, isActive: true, isDeleted: false } }),
    prisma.user.count({ where: { restaurantId, ...(branchId !== null ? { branchId } : {}), isActive: true, isDeleted: false } }),
    prisma.ingredient.findMany({ where: { restaurantId }, select: { quantity: true, pricePerUnit: true } }),
    prisma.dailyCashSession.findMany({ where: { restaurantId, ...(branchId !== null ? { branchId } : {}) }, orderBy: { businessDate: "desc" }, distinct: ["branchId"] }),
  ]);

  const scopedRows = branchId !== null ? branchComparisonCurrent.filter((r) => r.branch.id === branchId) : branchComparisonCurrent;
  const previousScopedRows = branchId !== null ? branchComparisonPrevious.filter((r) => r.branch.id === branchId) : branchComparisonPrevious;
  const totalCustomers = scopedRows.reduce((s, r) => s + r.totalCustomers, 0);
  const repeatCustomers = scopedRows.reduce((s, r) => s + r.repeatCustomers, 0);
  const previousTotalCustomers = previousScopedRows.reduce((s, r) => s + r.totalCustomers, 0);
  const repeatCustomerRate = totalCustomers > 0 ? Math.round((repeatCustomers / totalCustomers) * 100) : null;
  const previousRepeatCustomers = previousScopedRows.reduce((s, r) => s + r.repeatCustomers, 0);
  const previousRepeatCustomerRate = previousTotalCustomers > 0 ? Math.round((previousRepeatCustomers / previousTotalCustomers) * 100) : null;
  const customerGrowthPercentage = previousTotalCustomers > 0 ? Math.round(((totalCustomers - previousTotalCustomers) / previousTotalCustomers) * 1000) / 10 : null;

  // Inventory Value has no branch dimension in the schema (Ingredient is restaurant-wide) — reported at the restaurant level regardless of the requested scope, disclosed in the report.
  const inventoryValue = ingredients.reduce((s, i) => s + (i.quantity || 0) * (i.pricePerUnit || 0), 0);
  // Cash Position: the most recent session's closing balance once closed, otherwise its live expected balance — summed across every branch in scope.
  const cashPosition = cashSessions.reduce((s, c) => s + (c.status === "CLOSED" ? c.closingCash : c.expectedCash), 0);

  const insightsForTargets = isSingleBranchInsights(insightsData) ? insightsData : null;

  const rawRows: { key: string; label: string; unit: "currency" | "percentage" | "count"; current: number | null; previous: number | null }[] = [
    { key: "revenue", label: "Total Revenue", unit: "currency", current: current.metrics.revenue, previous: previous.metrics.revenue },
    { key: "orders", label: "Total Orders", unit: "count", current: current.metrics.orders, previous: previous.metrics.orders },
    { key: "avgOrderValue", label: "Average Order Value", unit: "currency", current: Math.round(current.metrics.avgOrderValue), previous: Math.round(previous.metrics.avgOrderValue) },
    { key: "grossProfit", label: "Gross Profit", unit: "currency", current: current.metrics.grossProfit, previous: previous.metrics.grossProfit },
    { key: "grossProfitMarginPercentage", label: "Gross Margin %", unit: "percentage", current: current.metrics.grossProfitMarginPercentage, previous: previous.metrics.grossProfitMarginPercentage },
    { key: "ebitda", label: "EBITDA", unit: "currency", current: current.metrics.ebitda, previous: previous.metrics.ebitda },
    { key: "ebitdaPercentage", label: "EBITDA %", unit: "percentage", current: current.metrics.ebitdaPercentage, previous: previous.metrics.ebitdaPercentage },
    { key: "netProfit", label: "Net Profit", unit: "currency", current: current.metrics.netProfit, previous: previous.metrics.netProfit },
    { key: "foodCostPercentage", label: "Food Cost %", unit: "percentage", current: current.metrics.foodCostPercentage, previous: previous.metrics.foodCostPercentage },
    { key: "labourCostPercentage", label: "Labour Cost %", unit: "percentage", current: current.metrics.labourCostPercentage, previous: previous.metrics.labourCostPercentage },
    { key: "primeCostPercentage", label: "Prime Cost %", unit: "percentage", current: current.metrics.primeCostPercentage, previous: previous.metrics.primeCostPercentage },
    { key: "customerGrowthPercentage", label: "Customer Growth %", unit: "percentage", current: customerGrowthPercentage, previous: null },
    { key: "repeatCustomerRate", label: "Repeat Customer %", unit: "percentage", current: repeatCustomerRate, previous: previousRepeatCustomerRate },
    { key: "branchCount", label: "Branch Count", unit: "count", current: branchCount, previous: null },
    { key: "activeEmployees", label: "Active Employees", unit: "count", current: activeEmployees, previous: null },
    { key: "inventoryValue", label: "Inventory Value", unit: "currency", current: Math.round(inventoryValue), previous: null },
    { key: "cashPosition", label: "Cash Position", unit: "currency", current: Math.round(cashPosition), previous: null },
  ];

  const rowsWithNativeTargets = rawRows.map((row) => ({ ...row, nativeTarget: nativeTargetFor(row.key, assumptions, insightsForTargets) }));
  const targetsByKey = await resolveKpiTargetsBatch(restaurantId, branchId, rowsWithNativeTargets.map((r) => ({ key: r.key, nativeTarget: r.nativeTarget })));
  const kpis = rowsWithNativeTargets.map((row) => {
    const higherIsBetter = HIGHER_IS_BETTER[row.key] ?? true;
    const variance = computeVariance(row.current, row.previous);
    const target = targetsByKey.get(row.key) ?? null;
    const achievementPercentage = computeAchievement(row.current, target, higherIsBetter);
    return {
      key: row.key, label: row.label, unit: row.unit, higherIsBetter,
      current: row.current, previousPeriod: row.previous,
      variance: variance.variance, variancePercentage: variance.variancePercentage, trendDirection: variance.trendDirection,
      target, achievementPercentage, status: statusForScore(achievementPercentage) as CategoryStatus,
    };
  });

  return {
    restaurantId, branchId, period, startDate: range.startDate.toISOString(), endDate: range.endDate.toISOString(), kpis,
  };
};

// ── KPI Scorecards (spec section 2 — adds Budget + Forecast columns for the shared finance KPIs) ──

const SCORECARD_KEYS = ["revenue", "foodCostPercentage", "labourCostPercentage", "primeCostPercentage", "ebitda", "ebitdaPercentage", "netProfit"];

export const getKpiScorecardsService = async (restaurantId: number, branchId: number | null, period: PeriodKey, from?: string, to?: string): Promise<KpiScorecardRow[]> => {
  const [overview, budgets, forecast] = await Promise.all([
    getExecutiveOverviewService(restaurantId, branchId, period, from, to),
    listBudgetsService(restaurantId, { branchId: branchId ?? undefined, status: "PUBLISHED" }),
    generateForecastService(restaurantId, branchId, "NEXT_MONTH", "HISTORICAL_TREND", undefined, false),
  ]);

  let budgetByKey: Record<string, any> = {};
  if (budgets[0]) {
    const variance = await getBudgetVarianceService(restaurantId, budgets[0].id, period, from, to);
    budgetByKey = Object.fromEntries(variance.rows.map((r: any) => [r.category, r]));
  }
  const forecastByKey = Object.fromEntries(forecast.kpis.map((k: any) => [k.key, k]));
  const overviewByKey = Object.fromEntries(overview.kpis.map((r: any) => [r.key, r]));

  return SCORECARD_KEYS.map((key) => {
    const row = overviewByKey[key];
    return {
      key: row.key, label: row.label, unit: row.unit, higherIsBetter: row.higherIsBetter,
      current: row.current, target: row.target, previousPeriod: row.previousPeriod,
      budget: budgetByKey[key]?.budget ?? null, forecast: forecastByKey[key]?.predicted ?? null,
      achievementPercentage: row.achievementPercentage, trendDirection: row.trendDirection, status: row.status,
    };
  });
};

// ── Business Health Score (spec section 3) ───────────────────────────────

export const getBusinessHealthScoreService = async (
  restaurantId: number,
  branchId: number | null,
  period: PeriodKey,
  from?: string,
  to?: string,
  /** Pass an already-fetched overview (getExecutiveOverviewService) when the
   * caller has one, to avoid recomputing the same ~8-query overview a
   * second time — the duplicate cost compounds across generateInsightsService
   * and getMultiBranchExecutiveViewService's per-branch loop. Fetched
   * internally otherwise so standalone callers don't need to know about this. */
  precomputedOverview?: Awaited<ReturnType<typeof getExecutiveOverviewService>>,
): Promise<BusinessHealthScoreResult> => {
  const overview = precomputedOverview ?? await getExecutiveOverviewService(restaurantId, branchId, period, from, to);
  const byKey = Object.fromEntries(overview.kpis.map((r: any) => [r.key, r]));

  const [forecastAccuracy, budgets] = await Promise.all([
    getForecastAccuracyReportService(restaurantId, branchId),
    listBudgetsService(restaurantId, { branchId: branchId ?? undefined, status: "PUBLISHED" }),
  ]);
  const forecastAccuracyScore = forecastAccuracy.kpiAccuracy.length > 0
    ? forecastAccuracy.kpiAccuracy.reduce((s: number, k: any) => s + k.averageAccuracyPercentage, 0) / forecastAccuracy.kpiAccuracy.length
    : null;

  let budgetAchievementScore: number | null = null;
  if (budgets[0]) {
    const variance = await getBudgetVarianceService(restaurantId, budgets[0].id, period, from, to);
    const achievements = variance.rows.map((r: any) => r.achievementPercentage).filter((v: any): v is number => v !== null);
    budgetAchievementScore = achievements.length > 0 ? achievements.reduce((s: number, v: number) => s + v, 0) / achievements.length : null;
  }

  // Branch Performance is only meaningful restaurant-wide — reuses getMultiBranchExecutiveViewService
  // (which itself calls this function per branch, branchId !== null, so this never recurses further).
  let branchPerformanceScore: number | null = null;
  if (branchId === null) {
    const multiBranch = await getMultiBranchExecutiveViewService(restaurantId, period, from, to);
    branchPerformanceScore = multiBranch.branches.length > 0
      ? multiBranch.branches.reduce((s, b) => s + b.healthScore, 0) / multiBranch.branches.length
      : null;
  }

  // A simple, documented transform: 0% growth reads as a neutral 50; +/-50% growth saturates the 0-100 range.
  const customerGrowthScore = byKey.customerGrowthPercentage?.current != null ? 50 + byKey.customerGrowthPercentage.current : null;

  const categories: HealthCategoryInput[] = [
    { key: "revenueAchievement", label: "Revenue Achievement", score: byKey.revenue?.achievementPercentage ?? null, weight: DEFAULT_HEALTH_WEIGHTS.revenueAchievement },
    { key: "ebitda", label: "EBITDA", score: byKey.ebitdaPercentage?.achievementPercentage ?? null, weight: DEFAULT_HEALTH_WEIGHTS.ebitda },
    { key: "netProfit", label: "Net Profit", score: byKey.netProfit?.achievementPercentage ?? null, weight: DEFAULT_HEALTH_WEIGHTS.netProfit },
    { key: "foodCost", label: "Food Cost", score: byKey.foodCostPercentage?.achievementPercentage ?? null, weight: DEFAULT_HEALTH_WEIGHTS.foodCost },
    { key: "labourCost", label: "Labour Cost", score: byKey.labourCostPercentage?.achievementPercentage ?? null, weight: DEFAULT_HEALTH_WEIGHTS.labourCost },
    { key: "primeCost", label: "Prime Cost", score: byKey.primeCostPercentage?.achievementPercentage ?? null, weight: DEFAULT_HEALTH_WEIGHTS.primeCost },
    { key: "forecastAccuracy", label: "Forecast Accuracy", score: forecastAccuracyScore, weight: DEFAULT_HEALTH_WEIGHTS.forecastAccuracy },
    { key: "budgetAchievement", label: "Budget Achievement", score: budgetAchievementScore, weight: DEFAULT_HEALTH_WEIGHTS.budgetAchievement },
    { key: "customerGrowth", label: "Customer Growth", score: customerGrowthScore, weight: DEFAULT_HEALTH_WEIGHTS.customerGrowth },
    { key: "branchPerformance", label: "Branch Performance", score: branchPerformanceScore, weight: DEFAULT_HEALTH_WEIGHTS.branchPerformance },
  ];

  return computeBusinessHealthScore(categories);
};

// ── Multi-Branch Executive View (spec section 4) ─────────────────────────

export const getMultiBranchExecutiveViewService = async (restaurantId: number, period: PeriodKey, from?: string, to?: string) => {
  const branches = await prisma.branch.findMany({ where: { restaurantId, isActive: true, isDeleted: false }, select: { id: true, name: true } });
  const investmentRanking = await rankBranchInvestmentsService(restaurantId).catch(() => [] as any[]);

  const rows = await Promise.all(branches.map(async (branch) => {
    // Sequenced (not Promise.all) so getBusinessHealthScoreService reuses
    // this same overview instead of independently recomputing it.
    const overview = await getExecutiveOverviewService(restaurantId, branch.id, period, from, to);
    const health = await getBusinessHealthScoreService(restaurantId, branch.id, period, from, to, overview);
    const byKey = Object.fromEntries(overview.kpis.map((r: any) => [r.key, r]));
    const investment = investmentRanking.find((r: any) => r.branch.id === branch.id);
    return {
      branch,
      revenue: byKey.revenue?.current ?? null,
      netProfit: byKey.netProfit?.current ?? null,
      ebitda: byKey.ebitda?.current ?? null,
      foodCostPercentage: byKey.foodCostPercentage?.current ?? null,
      labourCostPercentage: byKey.labourCostPercentage?.current ?? null,
      // Already computed by the same overview call above — exposed here (not
      // a new query) for Phase 8's Branch AI Narratives, which need to
      // compare a branch's AOV/repeat-rate against the network average.
      avgOrderValue: byKey.avgOrderValue?.current ?? null,
      repeatCustomerRate: byKey.repeatCustomerRate?.current ?? null,
      budgetAchievementPercentage: null as number | null, // populated below only when a published budget exists for that branch
      revenueTrendPercentage: byKey.revenue?.variancePercentage ?? null,
      roi: investment?.bestROI ?? null,
      healthScore: health.overall,
      healthStatus: health.status,
    };
  }));

  // Populate Budget Achievement per branch only where a published budget exists — kept as a second pass to avoid an N+1 inside the primary Promise.all when most branches have none.
  await Promise.all(rows.map(async (row) => {
    const budgets = await listBudgetsService(restaurantId, { branchId: row.branch.id, status: "PUBLISHED" });
    if (!budgets[0]) return;
    const variance = await getBudgetVarianceService(restaurantId, budgets[0].id, period, from, to);
    const achievements = variance.rows.map((r: any) => r.achievementPercentage).filter((v: any): v is number => v !== null);
    row.budgetAchievementPercentage = achievements.length > 0 ? Math.round((achievements.reduce((s: number, v: number) => s + v, 0) / achievements.length) * 10) / 10 : null;
  }));

  const ranked = [...rows].sort((a, b) => b.healthScore - a.healthScore);
  const bestPerforming = ranked[0] ?? null;
  const lowestPerforming = ranked[ranked.length - 1] ?? null;
  const mostImproved = [...rows].sort((a, b) => (b.revenueTrendPercentage ?? -Infinity) - (a.revenueTrendPercentage ?? -Infinity))[0] ?? null;
  const highestRisk = [...rows].sort((a, b) => a.healthScore - b.healthScore).find((r) => r.healthStatus === "critical") ?? null;

  return { branches: ranked, bestPerforming, mostImproved, highestRisk, lowestPerforming };
};

// ── Executive Timeline (spec section 5) ──────────────────────────────────

type Granularity = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";
const TIMELINE_COUNTS: Record<Granularity, number> = { daily: 14, weekly: 12, monthly: 12, quarterly: 8, yearly: 3 };

const buildTimelineRanges = (granularity: Granularity, count: number): DateRange[] => {
  const now = new Date();
  const ranges: DateRange[] = [];
  for (let i = count - 1; i >= 0; i--) {
    if (granularity === "daily") {
      const d = new Date(now); d.setDate(d.getDate() - i);
      ranges.push({ startDate: startOfDay(d), endDate: endOfDay(d) });
    } else if (granularity === "weekly") {
      const d = new Date(now); d.setDate(d.getDate() - 7 * i);
      ranges.push({ startDate: startOfWeek(d), endDate: endOfWeek(d) });
    } else if (granularity === "monthly") {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      ranges.push({ startDate: startOfMonth(d), endDate: endOfMonth(d) });
    } else if (granularity === "quarterly") {
      const d = new Date(now.getFullYear(), now.getMonth() - 3 * i, 1);
      ranges.push({ startDate: startOfQuarter(d), endDate: endOfQuarter(d) });
    } else {
      const d = new Date(now.getFullYear() - i, 0, 1);
      ranges.push({ startDate: startOfYear(d), endDate: endOfYear(d) });
    }
  }
  return ranges;
};

const labelFor = (granularity: Granularity, range: DateRange): string => {
  if (granularity === "daily") return localDateStr(range.startDate);
  if (granularity === "yearly") return String(range.startDate.getFullYear());
  if (granularity === "quarterly") return `Q${Math.floor(range.startDate.getMonth() / 3) + 1} ${range.startDate.getFullYear()}`;
  if (granularity === "weekly") return localDateStr(range.startDate);
  return `${range.startDate.toLocaleString("en-IN", { month: "short" })} ${range.startDate.getFullYear()}`;
};

export const getExecutiveTimelineService = async (restaurantId: number, branchId: number | null, granularity: Granularity) => {
  const ranges = buildTimelineRanges(granularity, TIMELINE_COUNTS[granularity]);
  const [insightsData, menuItemCostMap, payrollPolicyMap] = await Promise.all([fetchInsightsForScope(restaurantId, branchId), getMenuItemCostMap(restaurantId), getPayrollPolicyMap(restaurantId)]);

  const points = await Promise.all(ranges.map(async (range) => {
    const bundle = await resolveScopedMetrics(restaurantId, branchId, range, menuItemCostMap, insightsData, payrollPolicyMap);
    return {
      label: labelFor(granularity, range), startDate: range.startDate.toISOString(), endDate: range.endDate.toISOString(),
      revenue: bundle.metrics.revenue, netProfit: bundle.metrics.netProfit, ebitda: bundle.metrics.ebitda,
      // Already computed by the same resolveScopedMetrics call above — exposed
      // here (not a new query) for Phase 8's anomaly detection, which needs a
      // historical series for Food Cost %/Labour Cost % alongside the trend lines.
      foodCostPercentage: bundle.metrics.foodCostPercentage, labourCostPercentage: bundle.metrics.labourCostPercentage,
    };
  }));

  const budgets = await listBudgetsService(restaurantId, { branchId: branchId ?? undefined, status: "PUBLISHED" });
  let budgetAchievementTrend: { label: string; achievementPercentage: number | null }[] = [];
  if (budgets[0]) {
    budgetAchievementTrend = await Promise.all(ranges.map(async (range) => {
      const variance = await getBudgetVarianceService(restaurantId, budgets[0].id, "custom", localDateStr(range.startDate), localDateStr(range.endDate));
      const achievements = variance.rows.map((r: any) => r.achievementPercentage).filter((v: any): v is number => v !== null);
      return { label: labelFor(granularity, range), achievementPercentage: achievements.length > 0 ? Math.round((achievements.reduce((s: number, v: number) => s + v, 0) / achievements.length) * 10) / 10 : null };
    }));
  }

  // Forecast trend — reuses already-persisted snapshots (Phase 5), never recomputed here.
  const forecastSnapshots = await prisma.financialForecast.findMany({ where: { restaurantId, branchId }, orderBy: { targetStartDate: "desc" }, take: 12 });

  // Investment timeline — a chronological listing, not a numeric trend (spec explicitly separates it from the trend metrics above).
  const investmentTimeline = await prisma.investmentProject.findMany({
    where: { restaurantId, ...(branchId !== null ? { branchId } : {}) },
    orderBy: { plannedStartDate: "asc" },
    select: { id: true, name: true, type: true, status: true, plannedStartDate: true, expectedCompletionDate: true, initialInvestment: true },
  });

  return { granularity, points, budgetAchievementTrend, forecastSnapshots, investmentTimeline };
};

// ── Executive Alert Center (spec section 6) ──────────────────────────────

export const getExecutiveAlertsService = async (restaurantId: number, branchId: number | null, period: PeriodKey, from?: string, to?: string): Promise<ExecutiveAlert[]> => {
  const alerts: ExecutiveAlert[] = [];

  const [overview, forecast, budgets, portfolio] = await Promise.all([
    getExecutiveOverviewService(restaurantId, branchId, period, from, to),
    generateForecastService(restaurantId, branchId, "NEXT_MONTH", "HISTORICAL_TREND", undefined, false),
    listBudgetsService(restaurantId, { branchId: branchId ?? undefined, status: "PUBLISHED" }),
    getPortfolioSummaryService(restaurantId, { branchId }),
  ]);
  const byKey = Object.fromEntries(overview.kpis.map((r: any) => [r.key, r]));

  if (byKey.revenue?.achievementPercentage != null && byKey.revenue.achievementPercentage < 90) {
    alerts.push({
      key: "revenue", severity: byKey.revenue.achievementPercentage < 75 ? "critical" : "warning",
      message: `Revenue is at ${byKey.revenue.achievementPercentage.toFixed(0)}% of target.`,
      impact: "Lower revenue directly reduces EBITDA and cash available for reinvestment.",
      recommendedAction: "Review pricing, promotions, and channel mix; check Forecasting for the expected trajectory.",
      linkTo: "/dashboard/financial-statements",
    });
  }
  if (byKey.foodCostPercentage?.achievementPercentage != null && byKey.foodCostPercentage.achievementPercentage < 100) {
    alerts.push({
      key: "foodCost", severity: byKey.foodCostPercentage.achievementPercentage < 90 ? "critical" : "warning",
      message: `Food Cost is at ${byKey.foodCostPercentage.current}%, above target.`,
      impact: "Elevated food cost compresses gross margin directly.",
      recommendedAction: "Audit portioning, wastage, and current supplier pricing.",
      linkTo: "/dashboard/insights",
    });
  }
  if (byKey.labourCostPercentage?.trendDirection === "up" && (byKey.labourCostPercentage.variancePercentage ?? 0) >= 5) {
    alerts.push({
      key: "labourCost", severity: "warning", message: "Labour Cost % is trending up versus the prior period.",
      impact: "Rising labour cost erodes EBITDA if revenue doesn't grow proportionally.",
      recommendedAction: "Review shift scheduling and staffing levels against footfall.",
      linkTo: "/dashboard/attendance",
    });
  }
  if (byKey.ebitdaPercentage?.trendDirection === "down") {
    alerts.push({
      key: "ebitda", severity: "critical", message: "EBITDA % is falling versus the prior period.",
      impact: "A shrinking EBITDA margin threatens long-term profitability.",
      recommendedAction: "Review the Food Cost / Labour Cost / Operating Expense breakdown together.",
      linkTo: "/dashboard/financial-statements",
    });
  }
  if (forecast.overallConfidence === "low") {
    alerts.push({
      key: "forecastConfidence", severity: "warning", message: "Next month's forecast has low confidence.",
      impact: "Projections may be unreliable for planning purposes.",
      recommendedAction: forecast.confidenceReasons[0] || "Gather more historical data before relying on this forecast.",
      linkTo: "/dashboard/forecasting",
    });
  }
  forecast.alerts.filter((a: any) => a.key === "breakEvenRevenue").forEach((a: any) => alerts.push({
    key: "cashFlowRisk", severity: "critical", message: a.message,
    impact: "Revenue may not cover fixed costs in the coming period.",
    recommendedAction: "Review the Break-even analysis in Forecasting.", linkTo: "/dashboard/forecasting",
  }));
  if (budgets[0]) {
    const variance = await getBudgetVarianceService(restaurantId, budgets[0].id, period, from, to);
    variance.rows.filter((r: any) => r.status === "critical").forEach((r: any) => alerts.push({
      key: `budget-${r.category}`, severity: "critical",
      message: `${r.label} is critically off budget${r.achievementPercentage != null ? ` (${r.achievementPercentage.toFixed(0)}% achievement)` : ""}.`,
      impact: "Consistent budget misses compound over the financial year.",
      recommendedAction: "Revisit this category's budget assumptions or investigate the variance driver.",
      linkTo: "/dashboard/budget",
    }));
  }
  portfolio.needsAttention.forEach((p: any) => alerts.push({
    key: `investment-${p.project.id}`, severity: "warning",
    message: `Investment "${p.project.name}" has a below-expectation ROI or payback.`,
    impact: "Capital may be tied up in an underperforming project.",
    recommendedAction: "Review the project's assumptions in Investment Analysis.",
    linkTo: "/dashboard/investment-analysis",
  }));
  if (branchId === null) {
    const multiBranch = await getMultiBranchExecutiveViewService(restaurantId, period, from, to);
    if (multiBranch.highestRisk) {
      alerts.push({
        key: `branch-${multiBranch.highestRisk.branch.id}`, severity: "critical",
        message: `${multiBranch.highestRisk.branch.name} is underperforming (Health Score ${multiBranch.highestRisk.healthScore}/100).`,
        impact: "An underperforming branch drags down consolidated results.",
        recommendedAction: "Review that branch's individual KPIs and consider a branch-specific action plan.",
        linkTo: "/dashboard/comparison",
      });
    }
  }

  return alerts;
};

// ── Executive Insight Panels (spec section 7) ────────────────────────────

export const getInsightPanelsService = async (restaurantId: number, branchId: number | null, period: PeriodKey, from?: string, to?: string) => {
  const [budgets, forecast, scenarios, portfolio] = await Promise.all([
    listBudgetsService(restaurantId, { branchId: branchId ?? undefined, status: "PUBLISHED" }),
    generateForecastService(restaurantId, branchId, "NEXT_MONTH", "HISTORICAL_TREND", undefined, false),
    listScenariosService(restaurantId, { branchId: branchId ?? undefined, activeOnly: true }),
    getPortfolioSummaryService(restaurantId, { branchId }),
  ]);

  let actualVsBudget: any = null;
  if (budgets[0]) {
    const variance = await getBudgetVarianceService(restaurantId, budgets[0].id, period, from, to);
    actualVsBudget = { budgetName: budgets[0].name, rows: variance.rows.slice(0, 6) };
  }

  return {
    actualVsBudget,
    forecastSummary: { periodType: forecast.periodType, modelUsed: forecast.modelUsed, confidence: forecast.overallConfidence, kpis: forecast.kpis.slice(0, 6) },
    scenarioSummary: scenarios.map((s: any) => ({ id: s.id, name: s.name, type: s.type })),
    investmentPortfolioSummary: { totalCapitalDeployed: portfolio.totalCapitalDeployed, averageROI: portfolio.averageROI, totalNPV: portfolio.totalNPV, projectCount: portfolio.projectCount },
    topOpportunities: portfolio.topPerforming.slice(0, 3),
    topRisks: portfolio.needsAttention.slice(0, 3),
  };
};

// ── Dashboard preferences (spec section 8) ───────────────────────────────

export const getDashboardPreferenceService = async (userId: number) => prisma.userDashboardPreference.findUnique({ where: { userId } });

export const saveDashboardPreferenceService = async (
  userId: number,
  restaurantId: number,
  payload: { layout?: any; pinnedKpis?: any; defaultPeriod?: string; defaultBranchId?: number | null },
) => {
  if (Object.keys(payload).length === 0) throw new ValidationError("No preference fields provided");
  return prisma.userDashboardPreference.upsert({
    where: { userId },
    update: { ...payload },
    create: { userId, restaurantId, ...payload },
  });
};
