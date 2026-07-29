import { PeriodKey } from "../../utils/dateRange";

export type { PeriodKey };

/** Raw cost/revenue inputs for one period, already resolved to real ₹ figures. */
export interface FinancialInputs {
  revenue: number;
  foodCost: number;
  labourCost: number;
  /** Rent, loan EMI, internet, phone, accounting, insurance, licenses. */
  fixedExpenses: number;
  /** Delivery charges, packaging, payment gateway, aggregator commission, electricity, gas, maintenance, fuel, marketing. */
  variableExpenses: number;
  /** Loan interest, CA fees, insurance cost, other taxes — excluded from EBITDA by definition. */
  financeCost: number;
  gst: number;
  avgOrderValue: number;
  orders: number;
  daysInPeriod: number;
}

/** Every derived KPI, computed once, consumed everywhere. */
export interface FinancialMetrics {
  revenue: number;
  /** Passthrough of the same inputs used to derive avgOrderValue — added for
   * the Budget module (Orders/AOV are budgetable categories) so it can read
   * them from here instead of re-querying bills independently. Not a new
   * calculation — computePeriodMetrics already computed both internally. */
  orders: number;
  avgOrderValue: number;
  foodCost: number;
  foodCostPercentage: number;
  labourCost: number;
  labourCostPercentage: number;
  primeCost: number;
  primeCostPercentage: number;
  grossProfit: number;
  grossProfitMarginPercentage: number;
  fixedExpenses: number;
  variableExpenses: number;
  totalExpenses: number;
  ebitda: number;
  ebitdaPercentage: number;
  financeCost: number;
  netProfit: number;
  netProfitMarginPercentage: number;
  contributionMargin: number;
  contributionMarginPercentage: number;
  breakEvenRevenue: number | null;
  breakEvenOrders: number | null;
  breakEvenADS: number | null;
  marginOfSafety: number | null;
  marginOfSafetyPercentage: number | null;
}

export interface PeriodMetrics extends FinancialMetrics {
  period: PeriodKey;
  startDate: string;
  endDate: string;
}

export interface VarianceMetrics {
  value: number | null;
  previousValue: number | null;
  variance: number | null;
  variancePercentage: number | null;
  trendDirection: "up" | "down" | "flat" | null;
}

/**
 * One row of the Ratio/Period Engine — a single KPI's value across every
 * standard period, its month-over-month comparison, its configured target,
 * and its trend. Built once (finance.ratios.ts) from the same
 * computePeriodMetrics/computeFinancialMetrics used by getFinancialSummaryService
 * — no separate calculation path.
 */
export interface RatioKpiRow {
  key: string;
  label: string;
  unit: "currency" | "percentage";
  /** Whether a higher value is better (Revenue, EBITDA) — governs achievement% direction for cost-type KPIs. */
  higherIsBetter: boolean;
  daily: number | null;
  weekly: number | null;
  monthly: number | null;
  quarterly: number | null;
  yearly: number | null;
  previousMonth: number | null;
  previousYear: number | null;
  /** Monthly vs previousMonth. */
  variance: number | null;
  variancePercentage: number | null;
  target: number | null;
  /** Direction-aware: for higherIsBetter KPIs, monthly/target; for cost-type KPIs, target/monthly (beating a lower target still reads ≥100%). */
  achievementPercentage: number | null;
  trendDirection: "up" | "down" | "flat" | null;
  trendPercentage: number | null;
}

export interface RatioReport {
  restaurantId: number;
  branchId: number;
  generatedAt: string;
  kpis: RatioKpiRow[];
}

export interface FinancialSummary {
  current: PeriodMetrics;
  previous: PeriodMetrics;
  variance: Record<
    | "revenue"
    | "foodCostPercentage"
    | "primeCostPercentage"
    | "ebitda"
    | "ebitdaPercentage"
    | "netProfit"
    | "grossProfitMarginPercentage"
    | "labourCostPercentage",
    VarianceMetrics
  >;
  targets: {
    /** From FinancialAssumptions (restaurant default + branch override resolved) — the single source of truth for every target/rate. */
    targetEbitda: number | null;
    targetFoodCost: number | null;
    targetPrimeCost: number | null;
    targetLabourCost: number | null;
    targetOccupancy: number | null;
    targetUtility: number | null;
    /** No FinancialAssumptions equivalent (not part of that model's field set) — still sourced from RestaurantInsights. */
    targetGrossMargin: number | null;
    monthlyRevenueGoal: number | null;
    monthlyProfitGoal: number | null;
  };
  isFoodCostManualOverride: boolean;
}
