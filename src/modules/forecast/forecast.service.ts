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
import { getCashOutflowProjectionService, CashFlowHorizon } from "../cashflow/cashflow.service";
import { getKitchenAnalyticsService } from "../analytics/analyticsAdvanced.service";
import { computeStaffRequirement } from "../analytics/peakHour.formulas";
import { convertQtyToIngredientUnit } from "../inventory/inventory.service";
import { combineConfidence, forecastSeries } from "./forecast.formulas";
import {
  ConfidenceLevel,
  DemandForecastItem,
  DemandForecastResult,
  ForecastAlert,
  ForecastGranularity,
  ForecastKpiRow,
  ForecastModelValue,
  ForecastPeriodTypeValue,
  ForecastResult,
  ForecastSnapshotPayload,
  ForecastVsActualRow,
  HistoricalPoint,
  InventoryForecastItem,
  PeakHourForecastResult,
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

// Cash Flow KPI wiring: only NEXT_WEEK/NEXT_MONTH/NEXT_QUARTER map onto the
// Cash Flow Predictor's horizon buckets (week/month/quarter, max 90 days).
// NEXT_6_MONTHS/NEXT_YEAR are intentionally left unmapped (see the cashFlow
// patch in generateForecastService below) — projecting vendor/EMI/payroll
// obligations 6-12 months out via date-ranged due-date queries would be
// noise, not signal, at that distance.
const CASH_FLOW_HORIZON_BY_PERIOD: Partial<Record<ForecastPeriodTypeValue, CashFlowHorizon>> = {
  NEXT_WEEK: "week",
  NEXT_MONTH: "month",
  NEXT_QUARTER: "quarter",
};

/**
 * The future date range being predicted, anchored on `asOf` (defaults to
 * real "now"). The override exists solely so a forecast can be regenerated
 * as-of a past moment — e.g. backfilling what "next month" would have
 * predicted back when that month was still in the future, for Forecast vs
 * Actual accuracy tracking on periods that already completed before this
 * feature was ever exercised. Every production call site omits it.
 */
export const resolveTargetRange = (periodType: ForecastPeriodTypeValue, asOf: Date = new Date()): DateRange => {
  const now = asOf;
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

/** The last `count` COMPLETE historical periods relative to `asOf` (never the period `asOf` itself falls in), oldest first. See resolveTargetRange's comment on why `asOf` is overridable. */
const historicalRanges = (granularity: ForecastGranularity, count: number, asOf: Date = new Date()): DateRange[] => {
  const now = asOf;
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

/** Caps how far back history is fetched to how long the scope had existed as of `asOf` — a new branch shouldn't fire 24 parallel queries for months before it opened. See resolveTargetRange's comment on why `asOf` is overridable. */
const maxCompletePeriodsSince = (createdAt: Date, granularity: ForecastGranularity, cap: number, asOf: Date = new Date()): number => {
  const now = asOf;
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

type KpiExtra = { rent: number | null; utilities: number | null; daysInPeriod: number | null };
type KpiDef = {
  key: string;
  label: string;
  unit: "currency" | "percentage" | "count";
  higherIsBetter: boolean;
  extractor: (m: FinancialMetrics, extra: KpiExtra) => number | null;
  target: (assumptions: AssumptionValues, insights: RestaurantInsightsRow | null) => number | null;
};

const KPI_DEFINITIONS: KpiDef[] = [
  { key: "revenue", label: "Revenue", unit: "currency", higherIsBetter: true, extractor: (m) => m.revenue, target: (_a, i) => i?.monthlyRevenueGoal ?? null },
  { key: "orders", label: "Orders", unit: "count", higherIsBetter: true, extractor: (m) => m.orders, target: () => null },
  { key: "avgOrderValue", label: "Average Order Value", unit: "currency", higherIsBetter: true, extractor: (m) => Math.round(m.avgOrderValue), target: () => null },
  // ADS = Average Daily Sales (revenue ÷ operating days in the period) — a
  // distinct concept from Average Order Value (revenue ÷ orders, above).
  // The codebase already has a "break-even ADS" (computeBreakEvenADS in
  // finance.formulas.ts: breakEvenRevenue ÷ daysInPeriod) but no plain ADS
  // for actual/projected revenue — this is that missing sibling, same
  // days-in-period divisor, just applied to revenue instead of break-even
  // revenue. daysInPeriod comes from `extra` (see KpiExtra) rather than
  // FinancialMetrics because daysInPeriod is a FinancialInputs field, not a
  // derived metric — same reason rent/utilities are threaded through `extra`
  // above.
  { key: "avgDailySales", label: "Average Daily Sales", unit: "currency", higherIsBetter: true, extractor: (m, e) => (e.daysInPeriod && e.daysInPeriod > 0 ? Math.round((m.revenue / e.daysInPeriod) * 100) / 100 : null), target: () => null },
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
  /** See resolveTargetRange's comment — overridden only when backfilling a snapshot for a period that's already completed; every production call site omits it. */
  asOfDate: Date = new Date(),
): Promise<ForecastResult> => {
  const { granularity, horizon } = HORIZON_BY_PERIOD[periodType];
  const targetRange = resolveTargetRange(periodType, asOfDate);

  const scope = branchId !== null
    ? await prisma.branch.findUnique({ where: { id: branchId }, select: { createdAt: true } })
    : await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { createdAt: true } });
  if (!scope) throw new ValidationError("Restaurant or branch not found");

  const cap = granularity === "week" ? MAX_HISTORICAL_WEEKS : MAX_HISTORICAL_MONTHS;
  const count = maxCompletePeriodsSince(scope.createdAt, granularity, cap, asOfDate);
  const ranges = historicalRanges(granularity, count, asOfDate);

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
  const mostRecentRange = ranges[ranges.length - 1] ?? null;
  const baselineExtra: KpiExtra = { rent: mostRecent?.rent ?? null, utilities: mostRecent?.utilities ?? null, daysInPeriod: mostRecentRange ? daysInRange(mostRecentRange) : null };
  const insightsForTargets = isSingleBranchInsights(insightsData) ? insightsData : null;

  const kpis: ForecastKpiRow[] = KPI_DEFINITIONS.map((def) => {
    const predicted = def.extractor(projected, { rent: projectedRent, utilities: projectedUtilities, daysInPeriod: daysInRange(targetRange) });
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

  // Cash Flow KPI: every other extractor above is a synchronous function of
  // the already-computed `projected` FinancialMetrics bundle and has no
  // access to restaurantId/branchId/targetRange (KPI_DEFINITIONS is a
  // module-level constant, not a closure over this call's scope) — reshaping
  // that shared, otherwise-pure pipeline to be async/scope-aware for one KPI
  // would be invasive. generateForecastService is already async and already
  // awaits several DB-backed helpers above, so instead the cashFlow row is
  // patched in as a post-processing step here, using getCashOutflowProjectionService
  // (cashflow module) for outflow combined with this call's OWN
  // aggregatedRevenue as inflow — avoiding a second revenue-forecast call
  // (and a forecast<->cashflow require() cycle; see cashflow.service.ts's
  // file header for why outflow is exposed standalone rather than this
  // module calling the cashflow module's full getCashFlowProjectionService).
  // Left as null (its KPI_DEFINITIONS default) for restaurant-wide scope
  // (branchId === null, since the Predictor's queries need one concrete
  // branch) and for NEXT_6_MONTHS/NEXT_YEAR (no horizon mapping — see
  // CASH_FLOW_HORIZON_BY_PERIOD above) or if the projection call itself
  // fails, rather than let a Cash Flow Predictor error fail the whole
  // forecast response.
  const cashFlowHorizon = CASH_FLOW_HORIZON_BY_PERIOD[periodType];
  if (branchId !== null && cashFlowHorizon) {
    const cashFlowKpi = kpis.find((k) => k.key === "cashFlow");
    if (cashFlowKpi) {
      try {
        const outflow = await getCashOutflowProjectionService(restaurantId, branchId, cashFlowHorizon);
        const predicted = Math.round(aggregatedRevenue) - outflow.total;
        const variance = computeVariance(predicted, cashFlowKpi.baseline);
        cashFlowKpi.predicted = predicted;
        cashFlowKpi.variance = variance.variance;
        cashFlowKpi.variancePercentage = variance.variancePercentage;
        cashFlowKpi.trendDirection = variance.trendDirection;
      } catch (err) {
        console.error("Cash Flow KPI projection failed, leaving predicted as null:", err);
      }
    }
  }

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
  const actualDays = daysInRange(range);
  const actualByKey: Record<string, number | null> = {
    ...(bundle.metrics as unknown as Record<string, number | null>),
    rent: bundle.rent,
    utilities: bundle.utilities,
    operatingExpenses: bundle.metrics.labourCost + bundle.metrics.fixedExpenses + bundle.metrics.variableExpenses,
    cashFlow: null,
    // Same divisor generateForecastService's avgDailySales KPI uses on the
    // predicted side (extra.daysInPeriod) — real revenue over the actual
    // completed period's own day count, not left null like cashFlow (a real
    // actual figure IS derivable here, unlike cashFlow's documented "no data
    // source exists" case above).
    avgDailySales: actualDays > 0 ? Math.round((bundle.metrics.revenue / actualDays) * 100) / 100 : null,
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

// ─── Peak Hour Forecast — extends the Forecast Engine with order-volume/staffing prediction ───

/**
 * Projects the branch's busiest-hour order volume forward, then derives the
 * staff headcount that volume needs. See PeakHourForecastResult's header
 * comment in forecast.types.ts for the reuse rationale: forecastSeries for
 * the projection (the SAME generic helper generateForecastService uses for
 * every raw revenue/orders/cost series above — not a second forecasting
 * mechanism), computeStaffRequirement (analytics/peakHour.formulas.ts) for
 * staffing — neither is reimplemented here.
 */
export const getPeakHourForecastService = async (
  restaurantId: number,
  branchId: number,
  periodType: ForecastPeriodTypeValue,
  requestedModel: ForecastModelValue,
): Promise<PeakHourForecastResult> => {
  const { granularity, horizon } = HORIZON_BY_PERIOD[periodType];
  const targetRange = resolveTargetRange(periodType);

  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { createdAt: true, restaurantId: true } });
  if (!branch || branch.restaurantId !== restaurantId) throw new ValidationError("Branch not found");

  const cap = granularity === "week" ? MAX_HISTORICAL_WEEKS : MAX_HISTORICAL_MONTHS;
  const count = maxCompletePeriodsSince(branch.createdAt, granularity, cap);
  const ranges = historicalRanges(granularity, count);

  // One point per historical period: the busiest hour-of-day's TOTAL order
  // count across that whole period — reuses getKitchenAnalyticsService's own
  // hour-of-day bucketing (the exact bucketing getPeakHourAnalysisService
  // already relies on for "today", see peakHour.service.ts's file header),
  // just called once per historical period instead of re-deriving that
  // bucketing math a second time.
  const points: HistoricalPoint[] = await Promise.all(
    ranges.map(async (range) => {
      const kitchen = await getKitchenAnalyticsService(restaurantId, branchId, range.startDate.toISOString(), range.endDate.toISOString());
      const peak = kitchen.hourlyData.reduce((best: any, h: any) => (h.orders > best.orders ? h : best), kitchen.hourlyData[0] ?? { orders: 0 });
      const hasActivity = kitchen.hourlyData.some((h: any) => h.orders > 0);
      return { value: peak?.orders ?? 0, hasActivity };
    }),
  );

  const series = forecastSeries(points, requestedModel, granularity, horizon);
  const perPeriod = series.perPeriod.map((v) => Math.round(v));
  const predictedPeakHourOrders = perPeriod[perPeriod.length - 1] ?? 0;
  const baselinePeakHourOrders = points.length > 0 ? Math.round(points[points.length - 1].value) : null;
  const variance = computeVariance(predictedPeakHourOrders, baselinePeakHourOrders);

  return {
    restaurantId,
    branchId,
    periodType,
    requestedModel,
    modelUsed: series.modelUsed,
    granularity,
    targetStartDate: targetRange.startDate.toISOString(),
    targetEndDate: targetRange.endDate.toISOString(),
    historicalPeriodsUsed: ranges.length,
    confidence: series.confidence.level,
    confidenceReasons: series.confidence.reasons,
    perPeriod,
    predictedPeakHourOrders,
    baselinePeakHourOrders,
    variancePercentage: variance.variancePercentage,
    trendDirection: variance.trendDirection,
    projectedStaffRequirement: computeStaffRequirement(predictedPeakHourOrders),
  };
};

// ─── Demand & Inventory Forecast (ingredient-level) ─────────────────────────

const DEMAND_TRAILING_DAYS = 30;
const DEFAULT_TOP_N_INGREDIENTS = 10;
const LOW_STOCK_DAYS_THRESHOLD = 7;

interface IngredientConsumptionSeries {
  ingredientId: number;
  name: string;
  unit: string | null;
  currentQuantity: number;
  reorderLevel: number | null;
  /** Oldest first, one point per calendar day over the trailing window. */
  dailyConsumption: HistoricalPoint[];
  totalConsumption: number;
}

/**
 * Reconstructs each ingredient's day-by-day consumption from PAID bills ×
 * MenuItemIngredient recipes over the trailing window — the exact same
 * theoretical-consumption method inventory.service.ts's
 * getDailyAuditPreviewService/getIngredientLifecycleService already use
 * (convertQtyToIngredientUnit, imported from there, is reused rather than
 * reimplemented), just bucketed per calendar day instead of per-audit-date/
 * per-month so it forms a real time series forecastSeries can consume.
 * Deliberately NOT dependent on DailyStockAudit rows (a manual, staff-
 * entered close-of-day process) — bills always exist, so this works even
 * for a branch that has never run a stock audit.
 */
const buildIngredientConsumptionSeries = async (
  restaurantId: number,
  branchId: number,
  trailingDays: number,
): Promise<IngredientConsumptionSeries[]> => {
  const since = new Date();
  since.setDate(since.getDate() - trailingDays);
  since.setHours(0, 0, 0, 0);

  const [ingredients, bills] = await Promise.all([
    prisma.ingredient.findMany({
      where: { restaurantId },
      select: { id: true, name: true, unit: true, quantity: true, reorderLevel: true },
    }),
    prisma.bill.findMany({
      where: { restaurantId, branchId, status: "PAID", createdAt: { gte: since } },
      select: { createdAt: true, items: { select: { menuItemId: true, quantity: true } } },
    }),
  ]);

  const menuItemIds = [...new Set(bills.flatMap((b) => b.items.filter((i) => i.menuItemId).map((i) => i.menuItemId!)))];
  const menuItemIngredients = menuItemIds.length > 0
    ? await prisma.menuItemIngredient.findMany({
        where: { menuItemId: { in: menuItemIds } },
        select: { menuItemId: true, ingredientId: true, quantity: true, unit: true },
      })
    : [];

  const miiByMenuItem = new Map<number, { ingredientId: number; quantity: number; unit: string | null }[]>();
  for (const mii of menuItemIngredients) {
    if (!miiByMenuItem.has(mii.menuItemId)) miiByMenuItem.set(mii.menuItemId, []);
    miiByMenuItem.get(mii.menuItemId)!.push(mii);
  }
  const ingredientUnitMap = new Map(ingredients.map((i) => [i.id, i.unit]));

  const dayKeys: string[] = [];
  for (let i = trailingDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dayKeys.push(d.toISOString().slice(0, 10));
  }
  const perDayPerIngredient = new Map<string, Map<number, number>>(dayKeys.map((k) => [k, new Map<number, number>()]));

  for (const bill of bills) {
    const dayKey = new Date(bill.createdAt).toISOString().slice(0, 10);
    const dayMap = perDayPerIngredient.get(dayKey);
    if (!dayMap) continue; // outside the trailing window (edge-of-range timestamp)
    for (const item of bill.items) {
      if (!item.menuItemId) continue;
      for (const mii of miiByMenuItem.get(item.menuItemId) || []) {
        const convertedQty = convertQtyToIngredientUnit(mii.quantity, mii.unit, ingredientUnitMap.get(mii.ingredientId));
        dayMap.set(mii.ingredientId, (dayMap.get(mii.ingredientId) || 0) + item.quantity * convertedQty);
      }
    }
  }

  return ingredients.map((ing) => {
    const dailyConsumption: HistoricalPoint[] = dayKeys.map((k) => {
      const v = perDayPerIngredient.get(k)?.get(ing.id) ?? 0;
      return { value: v, hasActivity: v > 0 };
    });
    const totalConsumption = dailyConsumption.reduce((s, p) => s + p.value, 0);
    return {
      ingredientId: ing.id,
      name: ing.name,
      unit: ing.unit,
      currentQuantity: ing.quantity ?? 0,
      reorderLevel: ing.reorderLevel ?? null,
      dailyConsumption,
      totalConsumption,
    };
  });
};

/**
 * The one function both getDemandForecastService and getInventoryForecastService
 * call to turn a per-day consumption history into a projected daily rate.
 * forecastSeries (forecast.formulas.ts) is the SAME generic time-series
 * helper every revenue/orders/cost series in this module already goes
 * through — passing `horizonDays` future daily points and dividing the
 * summed predictedTotal back down by that horizon recovers "the average
 * projected daily rate", with no second projection mechanism.
 *
 * `granularity` is always locked to "week" here — never "month", regardless
 * of the caller's own periodType. forecastSeasonal's model assumes 12
 * MONTHLY calendar points a year apart (see forecast.formulas.ts's own
 * comment on forecastSeasonal); that has no equivalent meaning for daily
 * ingredient-consumption data. Locking to "week" makes resolveEffectiveModel
 * downgrade a requested SEASONAL model to Historical Trend automatically —
 * reusing that existing downgrade rule rather than inventing a new one for
 * daily series.
 */
const projectDailyConsumption = (
  points: HistoricalPoint[],
  model: ForecastModelValue,
  horizonDays: number,
): { rate: number; modelUsed: ForecastModelValue; confidence: ConfidenceLevel } => {
  const safeHorizon = Math.max(1, horizonDays);
  const result = forecastSeries(points, model, "week", safeHorizon);
  const rate = Math.max(0, Math.round((result.predictedTotal / safeHorizon) * 1000) / 1000);
  return { rate, modelUsed: result.modelUsed, confidence: result.confidence.level };
};

/**
 * Demand Forecast — projects forward daily order-driven consumption for the
 * restaurant's top-N (by trailing volume) ingredients. Scoped to a branch
 * because consumption itself is inherently per-branch (bills belong to a
 * branch); Ingredient.quantity/reorderLevel are restaurant-wide fields — the
 * stock pool isn't split per branch in this schema (see bill.service.ts's
 * and runningOrder.service.ts's own `ingredient.update({ quantity: {
 * decrement } })` calls, which are branch-agnostic) — matching how
 * inventory.service.ts's own getDailyAuditPreviewService/
 * getIngredientLifecycleService already scope consumption to a branch while
 * reading ingredients restaurant-wide.
 */
export const getDemandForecastService = async (
  restaurantId: number,
  branchId: number,
  periodType: ForecastPeriodTypeValue,
  requestedModel: ForecastModelValue,
  topN: number = DEFAULT_TOP_N_INGREDIENTS,
): Promise<DemandForecastResult> => {
  const targetRange = resolveTargetRange(periodType);
  const horizonDays = Math.max(1, daysInRange(targetRange));

  const series = await buildIngredientConsumptionSeries(restaurantId, branchId, DEMAND_TRAILING_DAYS);
  const ranked = [...series].sort((a, b) => b.totalConsumption - a.totalConsumption).slice(0, Math.max(1, topN));

  const items: DemandForecastItem[] = ranked.map((ing) => {
    const projected = projectDailyConsumption(ing.dailyConsumption, requestedModel, horizonDays);
    const historicalDailyAverage = Math.round((ing.totalConsumption / Math.max(1, ing.dailyConsumption.length)) * 1000) / 1000;
    return {
      ingredientId: ing.ingredientId,
      name: ing.name,
      unit: ing.unit,
      historicalDailyAverage,
      projectedDailyConsumption: projected.rate,
      // The rate × the target period's own day count — e.g. NEXT_MONTH's
      // real day count, not a flat 30 — so "Projected Total" genuinely
      // matches the selected period, not just the trailing lookback window.
      projectedTotalConsumption: Math.round(projected.rate * horizonDays * 1000) / 1000,
      modelUsed: projected.modelUsed,
      confidence: projected.confidence,
    };
  });

  return { restaurantId, branchId, periodType, requestedModel, trailingDaysAnalyzed: DEMAND_TRAILING_DAYS, horizonDays, items };
};

/**
 * Inventory/Stock Forecast — for the same top-N ingredients PLUS any
 * ingredient currently at/below its reorderLevel (even if it's not a top-N
 * mover — a slow-moving ingredient can still be about to run out), estimates
 * days-until-stockout = currentQuantity ÷ projectedDailyConsumption, reusing
 * the EXACT SAME projectDailyConsumption helper getDemandForecastService
 * calls above (at horizonDays=1, i.e. "today's projected rate" — a
 * stock-out ETA is inherently a from-today projection, not tied to one of
 * the module's future accounting periods, so it doesn't take a periodType).
 * Returned as a flat list rather than a ForecastKpiRow — see
 * InventoryForecastItem's header comment in forecast.types.ts for why that
 * shape doesn't fit here.
 */
export const getInventoryForecastService = async (
  restaurantId: number,
  branchId: number,
  requestedModel: ForecastModelValue = "HISTORICAL_TREND",
  topN: number = DEFAULT_TOP_N_INGREDIENTS,
): Promise<InventoryForecastItem[]> => {
  const series = await buildIngredientConsumptionSeries(restaurantId, branchId, DEMAND_TRAILING_DAYS);
  const topByVolume = [...series].sort((a, b) => b.totalConsumption - a.totalConsumption).slice(0, Math.max(1, topN));
  const topIds = new Set(topByVolume.map((s) => s.ingredientId));
  const nearReorder = series.filter((s) => s.reorderLevel != null && s.currentQuantity <= s.reorderLevel && !topIds.has(s.ingredientId));
  const scoped = [...topByVolume, ...nearReorder];

  return scoped
    .map((ing) => {
      const projected = projectDailyConsumption(ing.dailyConsumption, requestedModel, 1);
      const daysUntilStockout = projected.rate > 0 ? Math.round((ing.currentQuantity / projected.rate) * 10) / 10 : null;
      const reorderRecommended =
        (daysUntilStockout !== null && daysUntilStockout <= LOW_STOCK_DAYS_THRESHOLD) ||
        (ing.reorderLevel != null && ing.currentQuantity <= ing.reorderLevel);
      return {
        ingredientId: ing.ingredientId,
        ingredientName: ing.name,
        unit: ing.unit,
        currentQuantity: ing.currentQuantity,
        reorderLevel: ing.reorderLevel,
        projectedDailyConsumption: projected.rate,
        daysUntilStockout,
        reorderRecommended,
      };
    })
    .sort((a, b) => (a.daysUntilStockout ?? Infinity) - (b.daysUntilStockout ?? Infinity));
};
