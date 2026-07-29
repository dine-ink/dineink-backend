// The Ratio/Period Engine — for every core KPI, the same value computed
// across every standard period (daily/weekly/monthly/quarterly/yearly) plus
// month-over-month and year-over-year comparison, target, achievement %, and
// trend. Built entirely on top of computePeriodMetrics/computeFinancialMetrics
// (the same functions getFinancialSummaryService uses) — there is no second
// calculation path here, only a different arrangement of the same numbers.
import prisma from "../../config/prisma";
import { resolveDateRange, daysInRange, DateRange } from "../../utils/dateRange";
import { getResolvedAssumptionsService } from "../financeAssumptions/financeAssumptions.service";
import { computeVariance } from "./finance.formulas";
import { computePeriodMetrics, getMenuItemCostMap, prorateMonthly, RestaurantInsightsRow } from "./finance.service";
import { FinancialMetrics, RatioKpiRow, RatioReport } from "./finance.types";

interface PeriodBundle {
  daily: FinancialMetrics;
  weekly: FinancialMetrics;
  monthly: FinancialMetrics;
  quarterly: FinancialMetrics;
  yearly: FinancialMetrics;
  previousMonth: FinancialMetrics;
  previousYear: FinancialMetrics;
}

/** Rent and utilities aren't part of FinancialMetrics (they're just folded into fixedExpenses/variableExpenses) — computed here directly from the same RestaurantInsights row, prorated the same way. */
const extraFiguresFor = (insights: RestaurantInsightsRow, range: DateRange) => {
  const days = daysInRange(range);
  return {
    rent: prorateMonthly(insights?.monthlyRent, days),
    utilities: prorateMonthly((insights?.electricity || 0) + (insights?.gas || 0), days),
  };
};

type KpiDefinition = {
  key: string;
  label: string;
  unit: "currency" | "percentage";
  higherIsBetter: boolean;
  extractor: (m: FinancialMetrics, extra: { rent: number; utilities: number }) => number | null;
  target: (targets: Awaited<ReturnType<typeof getResolvedAssumptionsService>>, insights: RestaurantInsightsRow) => number | null;
};

const KPI_DEFINITIONS: KpiDefinition[] = [
  {
    key: "revenue",
    label: "Revenue",
    unit: "currency",
    higherIsBetter: true,
    extractor: (m) => m.revenue,
    target: (_t, insights) => insights?.monthlyRevenueGoal ?? null,
  },
  {
    key: "foodCostPercentage",
    label: "Food Cost %",
    unit: "percentage",
    higherIsBetter: false,
    extractor: (m) => m.foodCostPercentage,
    target: (t) => t.foodCostTargetPercentage,
  },
  {
    key: "primeCostPercentage",
    label: "Prime Cost %",
    unit: "percentage",
    higherIsBetter: false,
    extractor: (m) => m.primeCostPercentage,
    target: (t) => t.primeCostTargetPercentage,
  },
  {
    key: "labourCostPercentage",
    label: "Labour Cost %",
    unit: "percentage",
    higherIsBetter: false,
    extractor: (m) => m.labourCostPercentage,
    target: (t) => t.labourTargetPercentage,
  },
  {
    key: "utilities",
    label: "Utilities",
    unit: "currency",
    higherIsBetter: false,
    extractor: (_m, extra) => extra.utilities,
    target: () => null,
  },
  {
    key: "rent",
    label: "Rent",
    unit: "currency",
    higherIsBetter: false,
    extractor: (_m, extra) => extra.rent,
    target: () => null,
  },
  {
    key: "occupancyPercentage",
    label: "Occupancy %",
    unit: "percentage",
    higherIsBetter: false,
    extractor: (m, extra) => (m.revenue > 0 ? Math.round((extra.rent / m.revenue) * 1000) / 10 : 0),
    target: (t) => t.occupancyTargetPercentage,
  },
  {
    key: "totalExpenses",
    label: "Expenses",
    unit: "currency",
    higherIsBetter: false,
    extractor: (m) => m.totalExpenses,
    target: () => null,
  },
  {
    key: "grossProfit",
    label: "Gross Profit",
    unit: "currency",
    higherIsBetter: true,
    extractor: (m) => m.grossProfit,
    target: () => null,
  },
  {
    key: "grossProfitMarginPercentage",
    label: "Gross Margin %",
    unit: "percentage",
    higherIsBetter: true,
    extractor: (m) => m.grossProfitMarginPercentage,
    target: (_t, insights) => insights?.targetGrossMargin ?? null,
  },
  {
    key: "ebitdaPercentage",
    label: "EBITDA %",
    unit: "percentage",
    higherIsBetter: true,
    extractor: (m) => m.ebitdaPercentage,
    target: (t) => t.ebitdaTargetPercentage,
  },
  {
    key: "netProfit",
    label: "Net Profit",
    unit: "currency",
    higherIsBetter: true,
    extractor: (m) => m.netProfit,
    target: (_t, insights) => insights?.monthlyProfitGoal ?? null,
  },
  {
    key: "breakEvenRevenue",
    label: "Break-even Revenue",
    unit: "currency",
    higherIsBetter: false,
    extractor: (m) => m.breakEvenRevenue,
    target: () => null,
  },
];

/** Achievement % — direction-aware, so "beating a lower target" and "beating a higher target" both read ≥100%. */
export const computeAchievement = (value: number | null, target: number | null, higherIsBetter: boolean): number | null => {
  if (value === null || target === null || target === 0) return null;
  const ratio = higherIsBetter ? value / target : target / value;
  return Math.round(ratio * 1000) / 10;
};

export const getRatioReportService = async (restaurantId: number, branchId: number): Promise<RatioReport> => {
  // menuItemCostMap is period-independent — fetched once and reused across
  // all 7 periods below instead of being re-queried per period.
  const [insights, assumptions, menuItemCostMap] = await Promise.all([
    prisma.restaurantInsights.findUnique({ where: { restaurantId_branchId: { restaurantId, branchId } } }),
    getResolvedAssumptionsService(restaurantId, branchId),
    getMenuItemCostMap(restaurantId),
  ]);

  const ranges: Record<keyof PeriodBundle, DateRange> = {
    daily: resolveDateRange("today"),
    weekly: resolveDateRange("currentWeek"),
    monthly: resolveDateRange("currentMonth"),
    quarterly: resolveDateRange("currentQuarter"),
    yearly: resolveDateRange("currentYear"),
    previousMonth: resolveDateRange("previousMonth"),
    previousYear: resolveDateRange("previousYear"),
  };

  const periodKeys = Object.keys(ranges) as (keyof PeriodBundle)[];
  const metricsByPeriod = await Promise.all(
    periodKeys.map((key) => computePeriodMetrics(restaurantId, branchId, ranges[key], insights, menuItemCostMap)),
  );
  const bundle = Object.fromEntries(periodKeys.map((key, i) => [key, metricsByPeriod[i]])) as unknown as PeriodBundle;
  const extraByPeriod = Object.fromEntries(
    periodKeys.map((key) => [key, extraFiguresFor(insights, ranges[key])]),
  ) as Record<keyof PeriodBundle, { rent: number; utilities: number }>;

  const kpis: RatioKpiRow[] = KPI_DEFINITIONS.map((def) => {
    const monthly = def.extractor(bundle.monthly, extraByPeriod.monthly);
    const previousMonth = def.extractor(bundle.previousMonth, extraByPeriod.previousMonth);
    const variance = computeVariance(monthly, previousMonth);
    const target = def.target(assumptions, insights);
    return {
      key: def.key,
      label: def.label,
      unit: def.unit,
      higherIsBetter: def.higherIsBetter,
      daily: def.extractor(bundle.daily, extraByPeriod.daily),
      weekly: def.extractor(bundle.weekly, extraByPeriod.weekly),
      monthly,
      quarterly: def.extractor(bundle.quarterly, extraByPeriod.quarterly),
      yearly: def.extractor(bundle.yearly, extraByPeriod.yearly),
      previousMonth,
      previousYear: def.extractor(bundle.previousYear, extraByPeriod.previousYear),
      variance: variance.variance,
      variancePercentage: variance.variancePercentage,
      target,
      achievementPercentage: computeAchievement(monthly, target, def.higherIsBetter),
      trendDirection: variance.trendDirection,
      trendPercentage: variance.variancePercentage,
    };
  });

  return { restaurantId, branchId, generatedAt: new Date().toISOString(), kpis };
};
