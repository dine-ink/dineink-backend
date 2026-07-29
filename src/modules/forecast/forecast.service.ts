// Forecasting — the Forecast Engine plus CRUD for FinancialForecast snapshots.
// Every raw ₹/count series (Revenue, Orders, Food Cost, Labour, Fixed/Variable
// Expenses, Finance Cost, Rent, Utilities) is forecast independently
// (forecast.formulas.ts) from its own real history — built exclusively via
// resolveScopedMetrics/fetchInsightsForScope/getMenuItemCostMap (the same
// functions Budget and Scenario already share). The forecast horizon's
// predicted totals are then summed into one aggregated FinancialInputs object
// and run through computeFinancialMetrics EXACTLY ONCE — the same formula
// engine every other module uses — so every derived percentage/EBITDA/
// break-even figure here is guaranteed consistent with the rest of the app.
// Nothing computed is ever written back to real financial data; the only
// thing persisted is a frozen snapshot of what was predicted, for later
// Forecast vs Actual comparison (see the schema comment on FinancialForecast
// for why that's a different, spec-mandated need from Scenario's "never
// persist" rule, not a violation of it).
import prisma from "../../config/prisma";
import {
  DateRange,
  daysInRange,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
} from "../../utils/dateRange";
import { computeFinancialMetrics, computeVariance } from "../finance/finance.formulas";
import { computeAchievement } from "../finance/finance.ratios";
import { fetchInsightsForScope, getMenuItemCostMap, getPayrollPolicyMap, resolveScopedMetrics, RestaurantInsightsRow, BranchPayrollPolicy } from "../finance/finance.service";
import { FinancialInputs, FinancialMetrics } from "../finance/finance.types";
import { getRestaurantDefaultsService, getResolvedAssumptionsService } from "../financeAssumptions/financeAssumptions.service";
import { AssumptionValues } from "../financeAssumptions/financeAssumptions.types";
import { combineConfidence, forecastSeries } from "./forecast.formulas";
import {
  ForecastAlert,
  ForecastGranularity,
  ForecastKpiRow,
  ForecastModelValue,
  ForecastPeriodTypeValue,
  ForecastResult,
  ForecastSnapshotPayload,
  ForecastVsActualRow,
  HistoricalPoint,
  SeriesForecastResult,
} from "./forecast.types";
import { ValidationError } from "./forecast.validation";

const HORIZON_BY_PERIOD: Record<ForecastPeriodTypeValue, { granularity: ForecastGranularity; horizon: number }> = {
  NEXT_WEEK: { granularity: "week", horizon: 1 },
  NEXT_MONTH: { granularity: "month", horizon: 1 },
  NEXT_QUARTER: { granularity: "month", horizon: 3 },
  NEXT_6_MONTHS: { granularity: "month", horizon: 6 },
  NEXT_YEAR: { granularity: "month", horizon: 12 },
};

const MAX_HISTORICAL_WEEKS = 16;
const MAX_HISTORICAL_MONTHS = 24;

/** The future date range being predicted, anchored on "now". */
export const resolveTargetRange = (periodType: ForecastPeriodTypeValue): DateRange => {
  const now = new Date();
  const { granularity, horizon } = HORIZON_BY_PERIOD[periodType];
  if (granularity === "week") {
    const nextWeekAnchor = new Date(startOfWeek(now));
    nextWeekAnchor.setDate(nextWeekAnchor.getDate() + 7);
    return { startDate: startOfWeek(nextWeekAnchor), endDate: endOfWeek(nextWeekAnchor) };
  }
  const nextMonthAnchor = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const lastMonthAnchor = new Date(now.getFullYear(), now.getMonth() + horizon, 1);
  return { startDate: startOfMonth(nextMonthAnchor), endDate: endOfMonth(lastMonthAnchor) };
};

/** The last `count` COMPLETE historical periods (never the current, still-in-progress one), oldest first. */
const historicalRanges = (granularity: ForecastGranularity, count: number): DateRange[] => {
  const now = new Date();
  const ranges: DateRange[] = [];
  for (let i = count; i >= 1; i--) {
    if (granularity === "week") {
      const anchor = new Date(now);
      anchor.setDate(anchor.getDate() - 7 * i);
      ranges.push({ startDate: startOfWeek(anchor), endDate: endOfWeek(anchor) });
    } else {
      const anchor = new Date(now.getFullYear(), now.getMonth() - i, 1);
      ranges.push({ startDate: startOfMonth(anchor), endDate: endOfMonth(anchor) });
    }
  }
  return ranges;
};

/** Caps how far back history is fetched to how long the scope has actually existed — a new branch shouldn't fire 24 parallel queries for months before it opened. */
const maxCompletePeriodsSince = (createdAt: Date, granularity: ForecastGranularity, cap: number): number => {
  const now = new Date();
  if (granularity === "week") {
    const weeksElapsed = Math.floor((startOfWeek(now).getTime() - startOfWeek(createdAt).getTime()) / (7 * 86_400_000));
    return Math.max(0, Math.min(cap, weeksElapsed));
  }
  const monthsElapsed = (now.getFullYear() - createdAt.getFullYear()) * 12 + (now.getMonth() - createdAt.getMonth());
  return Math.max(0, Math.min(cap, monthsElapsed));
};

interface PeriodSnapshot {
  metrics: FinancialMetrics;
  rent: number;
  utilities: number;
  hasActivity: boolean;
}

const buildPeriodSnapshots = async (
  restaurantId: number,
  branchId: number | null,
  ranges: DateRange[],
  menuItemCostMap: Map<number, number>,
  insightsData: Awaited<ReturnType<typeof fetchInsightsForScope>>,
  payrollPolicyMap: Map<number, BranchPayrollPolicy>,
): Promise<PeriodSnapshot[]> =>
  Promise.all(
    ranges.map(async (range) => {
      const bundle = await resolveScopedMetrics(restaurantId, branchId, range, menuItemCostMap, insightsData, payrollPolicyMap);
      return { metrics: bundle.metrics, rent: bundle.rent, utilities: bundle.utilities, hasActivity: bundle.metrics.orders > 0 };
    }),
  );

type RawSeriesKey = "revenue" | "orders" | "foodCost" | "labourCost" | "fixedExpenses" | "variableExpenses" | "financeCost" | "rent" | "utilities";
const RAW_SERIES_KEYS: RawSeriesKey[] = ["revenue", "orders", "foodCost", "labourCost", "fixedExpenses", "variableExpenses", "financeCost", "rent", "utilities"];

const extractSeries = (snapshots: PeriodSnapshot[], key: RawSeriesKey): HistoricalPoint[] =>
  snapshots.map((s) => ({
    value: key === "rent" ? s.rent : key === "utilities" ? s.utilities : (s.metrics[key as keyof FinancialMetrics] as number),
    hasActivity: s.hasActivity,
  }));

type KpiDef = {
  key: string;
  label: string;
  unit: "currency" | "percentage" | "count";
  higherIsBetter: boolean;
  extractor: (m: FinancialMetrics, extra: { rent: number | null; utilities: number | null }) => number | null;
  target: (assumptions: AssumptionValues, insights: RestaurantInsightsRow | null) => number | null;
};

const KPI_DEFINITIONS: KpiDef[] = [
  { key: "revenue", label: "Revenue", unit: "currency", higherIsBetter: true, extractor: (m) => m.revenue, target: (_a, i) => i?.monthlyRevenueGoal ?? null },
  { key: "orders", label: "Orders", unit: "count", higherIsBetter: true, extractor: (m) => m.orders, target: () => null },
  { key: "avgOrderValue", label: "Average Order Value", unit: "currency", higherIsBetter: true, extractor: (m) => Math.round(m.avgOrderValue), target: () => null },
  { key: "foodCost", label: "Food Cost", unit: "currency", higherIsBetter: false, extractor: (m) => m.foodCost, target: () => null },
  { key: "foodCostPercentage", label: "Food Cost %", unit: "percentage", higherIsBetter: false, extractor: (m) => m.foodCostPercentage, target: (a) => a.foodCostTargetPercentage },
  { key: "primeCost", label: "Prime Cost", unit: "currency", higherIsBetter: false, extractor: (m) => m.primeCost, target: () => null },
  { key: "primeCostPercentage", label: "Prime Cost %", unit: "percentage", higherIsBetter: false, extractor: (m) => m.primeCostPercentage, target: (a) => a.primeCostTargetPercentage },
  { key: "labourCost", label: "Labour", unit: "currency", higherIsBetter: false, extractor: (m) => m.labourCost, target: () => null },
  { key: "labourCostPercentage", label: "Labour %", unit: "percentage", higherIsBetter: false, extractor: (m) => m.labourCostPercentage, target: (a) => a.labourTargetPercentage },
  { key: "rent", label: "Rent", unit: "currency", higherIsBetter: false, extractor: (_m, e) => e.rent, target: () => null },
  { key: "utilities", label: "Utilities", unit: "currency", higherIsBetter: false, extractor: (_m, e) => e.utilities, target: (a) => a.utilityTargetPercentage },
  { key: "operatingExpenses", label: "Operating Expenses", unit: "currency", higherIsBetter: false, extractor: (m) => m.labourCost + m.fixedExpenses + m.variableExpenses, target: () => null },
  { key: "grossProfit", label: "Gross Profit", unit: "currency", higherIsBetter: true, extractor: (m) => m.grossProfit, target: () => null },
  { key: "grossProfitMarginPercentage", label: "Gross Margin %", unit: "percentage", higherIsBetter: true, extractor: (m) => m.grossProfitMarginPercentage, target: (_a, i) => i?.targetGrossMargin ?? null },
  { key: "ebitda", label: "EBITDA", unit: "currency", higherIsBetter: true, extractor: (m) => m.ebitda, target: () => null },
  { key: "ebitdaPercentage", label: "EBITDA %", unit: "percentage", higherIsBetter: true, extractor: (m) => m.ebitdaPercentage, target: (a) => a.ebitdaTargetPercentage },
  { key: "netProfit", label: "Net Profit", unit: "currency", higherIsBetter: true, extractor: (m) => m.netProfit, target: (_a, i) => i?.monthlyProfitGoal ?? null },
  { key: "breakEvenRevenue", label: "Break-even Sales", unit: "currency", higherIsBetter: false, extractor: (m) => m.breakEvenRevenue, target: () => null },
  { key: "breakEvenOrders", label: "Break-even Orders", unit: "count", higherIsBetter: false, extractor: (m) => m.breakEvenOrders, target: () => null },
  { key: "contributionMargin", label: "Contribution Margin", unit: "currency", higherIsBetter: true, extractor: (m) => m.contributionMargin, target: () => null },
  { key: "marginOfSafety", label: "Margin of Safety", unit: "currency", higherIsBetter: true, extractor: (m) => m.marginOfSafety, target: () => null },
  // No real cash-flow data source exists anywhere in the app yet (Budget's own variance rows already report this category as "no-data") — Forecast follows the same honest precedent rather than inventing a proxy.
  { key: "cashFlow", label: "Cash Flow", unit: "currency", higherIsBetter: true, extractor: () => null, target: () => null },
];

const isSingleBranchInsights = (
  insightsData: Awaited<ReturnType<typeof fetchInsightsForScope>>,
): insightsData is RestaurantInsightsRow => insightsData === null || !("branchIds" in (insightsData as object));

const buildAlerts = (kpis: ForecastKpiRow[], projected: FinancialMetrics): ForecastAlert[] => {
  const byKey = Object.fromEntries(kpis.map((k) => [k.key, k]));
  const alerts: ForecastAlert[] = [];

  const revenue = byKey.revenue;
  if (revenue?.trendDirection === "down" && (revenue.variancePercentage ?? 0) <= -5) {
    alerts.push({ severity: "warning", key: "revenue", message: `Revenue is expected to decline ${Math.abs(revenue.variancePercentage!).toFixed(1)}% versus the most recent period.` });
  } else if (revenue?.trendDirection === "up" && (revenue.variancePercentage ?? 0) >= 5) {
    alerts.push({ severity: "info", key: "revenue", message: `Sales are trending upward — revenue is projected to grow ${revenue.variancePercentage!.toFixed(1)}%.` });
  }

  const foodCostPct = byKey.foodCostPercentage;
  if (foodCostPct?.achievementPercentage !== null && foodCostPct?.achievementPercentage !== undefined && foodCostPct.achievementPercentage < 100) {
    alerts.push({ severity: "critical", key: "foodCostPercentage", message: `Food cost is projected at ${foodCostPct.predicted}% of revenue, above its target.` });
  }

  const ebitdaPct = byKey.ebitdaPercentage;
  if (ebitdaPct?.trendDirection === "down") {
    alerts.push({ severity: "warning", key: "ebitdaPercentage", message: "Profit margin (EBITDA %) is expected to decrease versus the most recent period." });
  }

  const labour = byKey.labourCost;
  if (labour?.trendDirection === "up" && (labour.variancePercentage ?? 0) >= 5) {
    alerts.push({ severity: "warning", key: "labourCost", message: `Labour cost is increasing — projected up ${labour.variancePercentage!.toFixed(1)}% versus the most recent period.` });
  }

  if (projected.marginOfSafety !== null && projected.marginOfSafety < 0) {
    alerts.push({ severity: "critical", key: "breakEvenRevenue", message: `Break-even may not be achieved — projected revenue falls short of break-even sales by ₹${Math.abs(projected.marginOfSafety).toLocaleString("en-IN")}.` });
  }

  return alerts;
};

export const generateForecastService = async (
  restaurantId: number,
  branchId: number | null,
  periodType: ForecastPeriodTypeValue,
  requestedModel: ForecastModelValue,
  createdById?: number,
  persist = true,
): Promise<ForecastResult> => {
  const { granularity, horizon } = HORIZON_BY_PERIOD[periodType];
  const targetRange = resolveTargetRange(periodType);

  const scope = branchId !== null
    ? await prisma.branch.findUnique({ where: { id: branchId }, select: { createdAt: true } })
    : await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { createdAt: true } });
  if (!scope) throw new ValidationError("Restaurant or branch not found");

  const cap = granularity === "week" ? MAX_HISTORICAL_WEEKS : MAX_HISTORICAL_MONTHS;
  const count = maxCompletePeriodsSince(scope.createdAt, granularity, cap);
  const ranges = historicalRanges(granularity, count);

  const [insightsData, assumptions, menuItemCostMap, payrollPolicyMap] = await Promise.all([
    fetchInsightsForScope(restaurantId, branchId),
    branchId !== null ? getResolvedAssumptionsService(restaurantId, branchId) : getRestaurantDefaultsService(restaurantId),
    getMenuItemCostMap(restaurantId),
    getPayrollPolicyMap(restaurantId),
  ]);

  const snapshots = ranges.length > 0 ? await buildPeriodSnapshots(restaurantId, branchId, ranges, menuItemCostMap, insightsData, payrollPolicyMap) : [];

  const seriesResults = Object.fromEntries(
    RAW_SERIES_KEYS.map((key) => [key, forecastSeries(extractSeries(snapshots, key), requestedModel, granularity, horizon)]),
  ) as Record<RawSeriesKey, SeriesForecastResult>;

  const aggregatedRevenue = seriesResults.revenue.predictedTotal;
  const aggregatedOrders = Math.round(seriesResults.orders.predictedTotal);
  const aggregatedInputs: FinancialInputs = {
    revenue: Math.round(aggregatedRevenue),
    foodCost: Math.round(seriesResults.foodCost.predictedTotal),
    labourCost: Math.round(seriesResults.labourCost.predictedTotal),
    fixedExpenses: Math.round(seriesResults.fixedExpenses.predictedTotal),
    variableExpenses: Math.round(seriesResults.variableExpenses.predictedTotal),
    financeCost: Math.round(seriesResults.financeCost.predictedTotal),
    gst: 0,
    orders: aggregatedOrders,
    avgOrderValue: aggregatedOrders > 0 ? aggregatedRevenue / aggregatedOrders : 0,
    daysInPeriod: daysInRange(targetRange),
  };
  const projected = computeFinancialMetrics(aggregatedInputs);
  const projectedRent = Math.round(seriesResults.rent.predictedTotal);
  const projectedUtilities = Math.round(seriesResults.utilities.predictedTotal);

  const mostRecent = snapshots[snapshots.length - 1] ?? null;
  const baselineExtra = { rent: mostRecent?.rent ?? null, utilities: mostRecent?.utilities ?? null };
  const insightsForTargets = isSingleBranchInsights(insightsData) ? insightsData : null;

  const kpis: ForecastKpiRow[] = KPI_DEFINITIONS.map((def) => {
    const predicted = def.extractor(projected, { rent: projectedRent, utilities: projectedUtilities });
    const baseline = mostRecent ? def.extractor(mostRecent.metrics, baselineExtra) : null;
    const variance = computeVariance(predicted, baseline);
    const target = def.target(assumptions, insightsForTargets);
    const achievementPercentage = computeAchievement(predicted, target, def.higherIsBetter);
    return {
      key: def.key,
      label: def.label,
      unit: def.unit,
      higherIsBetter: def.higherIsBetter,
      baseline,
      predicted,
      variance: variance.variance,
      variancePercentage: variance.variancePercentage,
      achievementPercentage,
      trendDirection: variance.trendDirection,
    };
  });

  const combined = combineConfidence(RAW_SERIES_KEYS.map((k) => seriesResults[k].confidence));

  const result: ForecastResult = {
    restaurantId,
    branchId,
    periodType,
    requestedModel,
    modelUsed: seriesResults.revenue.modelUsed, // the revenue series' effective model is reported as the headline model; individual series may have independently downgraded further — visible in confidenceReasons
    granularity,
    targetStartDate: targetRange.startDate.toISOString(),
    targetEndDate: targetRange.endDate.toISOString(),
    historicalPeriodsUsed: snapshots.length,
    overallConfidence: combined.level,
    confidenceReasons: combined.reasons,
    kpis,
    alerts: buildAlerts(kpis, projected),
  };

  if (persist) await ensureForecastSnapshotService(restaurantId, branchId, periodType, targetRange, result, createdById);

  return result;
};

/** Idempotent per (restaurantId, branchId, periodType, targetStartDate) — the first time a given future period is forecast for a scope, it's frozen for later Forecast vs Actual comparison; later calls for the same target period are a no-op. */
const ensureForecastSnapshotService = async (
  restaurantId: number,
  branchId: number | null,
  periodType: ForecastPeriodTypeValue,
  targetRange: DateRange,
  result: ForecastResult,
  createdById?: number,
): Promise<void> => {
  const existing = await prisma.financialForecast.findFirst({
    where: { restaurantId, branchId, periodType, targetStartDate: targetRange.startDate },
    select: { id: true },
  });
  if (existing) return;

  const payload: ForecastSnapshotPayload = {
    modelUsed: result.modelUsed,
    granularity: result.granularity,
    historicalPeriodsUsed: result.historicalPeriodsUsed,
    overallConfidence: result.overallConfidence,
    confidenceReasons: result.confidenceReasons,
    kpis: result.kpis.map((k) => ({ key: k.key, label: k.label, unit: k.unit, higherIsBetter: k.higherIsBetter, predicted: k.predicted })),
  };

  await prisma.financialForecast.create({
    data: {
      restaurantId,
      branchId,
      periodType: periodType as any,
      model: result.modelUsed as any,
      targetStartDate: targetRange.startDate,
      targetEndDate: targetRange.endDate,
      predictions: payload as any,
      createdById,
    },
  });
};

export const listForecastSnapshotsService = async (restaurantId: number, filters: { branchId?: number | null; periodType?: string }) =>
  prisma.financialForecast.findMany({
    where: {
      restaurantId,
      ...(filters.branchId !== undefined ? { branchId: filters.branchId } : {}),
      ...(filters.periodType ? { periodType: filters.periodType as any } : {}),
    },
    include: { branch: { select: { id: true, name: true } } },
    orderBy: { targetStartDate: "desc" },
  });

const findOwnedForecast = async (restaurantId: number, forecastId: number) => {
  const forecast = await prisma.financialForecast.findUnique({ where: { id: forecastId } });
  if (!forecast || forecast.restaurantId !== restaurantId) throw new ValidationError("Forecast not found");
  return forecast;
};

export const getForecastSnapshotService = async (restaurantId: number, forecastId: number) => findOwnedForecast(restaurantId, forecastId);

export const getForecastVsActualService = async (
  restaurantId: number,
  forecastId: number,
  /** Pass pre-fetched maps (getMenuItemCostMap/getPayrollPolicyMap) when comparing many forecasts in one request (see getForecastAccuracyReportService) to avoid re-querying menu items/branches once per forecast; fetched internally otherwise. */
  menuItemCostMapOverride?: Map<number, number>,
  payrollPolicyMapOverride?: Map<number, BranchPayrollPolicy>,
): Promise<{ forecastId: number; branchId: number | null; periodType: string; targetStartDate: string; targetEndDate: string; isComplete: boolean; rows: ForecastVsActualRow[] }> => {
  const snapshot = await findOwnedForecast(restaurantId, forecastId);
  const payload = snapshot.predictions as unknown as ForecastSnapshotPayload;
  const isComplete = snapshot.targetEndDate.getTime() < Date.now();

  const base = {
    forecastId,
    branchId: snapshot.branchId,
    periodType: snapshot.periodType,
    targetStartDate: snapshot.targetStartDate.toISOString(),
    targetEndDate: snapshot.targetEndDate.toISOString(),
    isComplete,
  };

  if (!isComplete) {
    return {
      ...base,
      rows: payload.kpis.map((k) => ({ key: k.key, label: k.label, unit: k.unit, higherIsBetter: k.higherIsBetter, forecast: k.predicted, actual: null, variance: null, variancePercentage: null, accuracyPercentage: null })),
    };
  }

  // Actual is always derived fresh from the Finance Engine for the exact scope+period the forecast targeted — never stored, never recomputed differently from anywhere else in the app.
  const [insightsData, menuItemCostMap, payrollPolicyMap] = await Promise.all([
    fetchInsightsForScope(restaurantId, snapshot.branchId),
    menuItemCostMapOverride ? Promise.resolve(menuItemCostMapOverride) : getMenuItemCostMap(restaurantId),
    payrollPolicyMapOverride ? Promise.resolve(payrollPolicyMapOverride) : getPayrollPolicyMap(restaurantId),
  ]);
  const range: DateRange = { startDate: snapshot.targetStartDate, endDate: snapshot.targetEndDate };
  const bundle = await resolveScopedMetrics(restaurantId, snapshot.branchId, range, menuItemCostMap, insightsData, payrollPolicyMap);
  const actualByKey: Record<string, number | null> = {
    ...(bundle.metrics as unknown as Record<string, number | null>),
    rent: bundle.rent,
    utilities: bundle.utilities,
    operatingExpenses: bundle.metrics.labourCost + bundle.metrics.fixedExpenses + bundle.metrics.variableExpenses,
    cashFlow: null,
  };

  const rows: ForecastVsActualRow[] = payload.kpis.map((k) => {
    const actual = actualByKey[k.key] ?? null;
    const variance = computeVariance(actual, k.predicted);
    const accuracyPercentage =
      actual !== null && k.predicted !== null && actual !== 0
        ? Math.max(0, Math.round((100 - Math.abs(((actual - k.predicted) / actual) * 100)) * 10) / 10)
        : null;
    return {
      key: k.key,
      label: k.label,
      unit: k.unit,
      higherIsBetter: k.higherIsBetter,
      forecast: k.predicted,
      actual,
      variance: variance.variance,
      variancePercentage: variance.variancePercentage,
      accuracyPercentage,
    };
  });

  return { ...base, rows };
};

export const getForecastAccuracyReportService = async (restaurantId: number, branchId: number | null) => {
  const snapshots = await prisma.financialForecast.findMany({
    where: { restaurantId, branchId, targetEndDate: { lt: new Date() } },
    orderBy: { targetEndDate: "desc" },
    take: 50, // bounded — a growing history of forecasts shouldn't make this report unbounded
  });

  const [menuItemCostMap, payrollPolicyMap] = await Promise.all([getMenuItemCostMap(restaurantId), getPayrollPolicyMap(restaurantId)]);
  const perForecast = await Promise.all(snapshots.map(async (s) => getForecastVsActualService(restaurantId, s.id, menuItemCostMap, payrollPolicyMap)));

  const accuracyByKey = new Map<string, { label: string; unit: string; total: number; count: number }>();
  perForecast.forEach((comparison) => {
    comparison.rows.forEach((r) => {
      if (r.accuracyPercentage === null) return;
      const existing = accuracyByKey.get(r.key) ?? { label: r.label, unit: r.unit, total: 0, count: 0 };
      existing.total += r.accuracyPercentage;
      existing.count += 1;
      accuracyByKey.set(r.key, existing);
    });
  });

  const kpiAccuracy = Array.from(accuracyByKey.entries()).map(([key, v]) => ({
    key,
    label: v.label,
    unit: v.unit,
    averageAccuracyPercentage: Math.round((v.total / v.count) * 10) / 10,
    sampleSize: v.count,
  }));

  return { restaurantId, branchId, completedForecastCount: snapshots.length, kpiAccuracy, forecasts: perForecast };
};

/**
 * Ranks every branch by expected Revenue/Profit/EBITDA/Growth for the same
 * period+model — reuses generateForecastService per branch (persist=false,
 * so viewing a ranking doesn't silently multiply stored snapshots; only the
 * single-scope forecast view accumulates history for accuracy tracking).
 */
export const rankBranchForecastsService = async (restaurantId: number, periodType: ForecastPeriodTypeValue, model: ForecastModelValue) => {
  const branches = await prisma.branch.findMany({ where: { restaurantId, isDeleted: false }, select: { id: true, name: true } });
  const results = await Promise.all(
    branches.map(async (branch) => ({ branch, forecast: await generateForecastService(restaurantId, branch.id, periodType, model, undefined, false) })),
  );

  const byKey = (forecast: ForecastResult, key: string) => forecast.kpis.find((k) => k.key === key)?.predicted ?? null;
  const ranked = results.map(({ branch, forecast }) => ({
    branch,
    revenue: byKey(forecast, "revenue"),
    netProfit: byKey(forecast, "netProfit"),
    ebitda: byKey(forecast, "ebitda"),
    growthPercentage: forecast.kpis.find((k) => k.key === "revenue")?.variancePercentage ?? null,
    confidence: forecast.overallConfidence,
  }));
  ranked.sort((a, b) => (b.revenue ?? -Infinity) - (a.revenue ?? -Infinity));
  return ranked;
};
