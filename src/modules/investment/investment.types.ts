export type InvestmentTypeValue =
  | "NEW_BRANCH" | "BRANCH_EXPANSION" | "KITCHEN_UPGRADE" | "EQUIPMENT_PURCHASE"
  | "INTERIOR_RENOVATION" | "DELIVERY_EXPANSION" | "MARKETING_INVESTMENT" | "FRANCHISE_OUTLET" | "CUSTOM";

export type InvestmentStatusValue = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

/** Every field the cash-flow projection needs — a plain, DB-independent shape so investment.formulas.ts stays pure and unit-testable without a Prisma row. */
export interface InvestmentAssumptions {
  initialInvestment: number;
  projectLifeYears: number;
  discountRate: number;
  inflationRate: number;
  monthlyRevenueIncrease: number;
  revenueGrowthPercentage: number;
  expectedCostSavings: number;
  labourSavings: number;
  additionalOperatingExpenses: number;
  maintenanceCost: number;
  salvageValue: number;
}

export interface CashFlowProjection {
  /** Year 1..N, length = projectLifeYears. The final year includes salvageValue. */
  annualCashFlows: number[];
  /** Year 0..N, length = projectLifeYears + 1. Index 0 = -initialInvestment. */
  cumulativeCashFlows: number[];
  /** Year 0..N discounted at discountRate, length = projectLifeYears + 1. Index 0 = -initialInvestment (undiscounted, t=0). */
  discountedCashFlows: number[];
}

export interface InvestmentMetrics {
  roiPercentage: number | null;
  annualizedRoiPercentage: number | null;
  paybackPeriodYears: number | null;
  discountedPaybackPeriodYears: number | null;
  npv: number | null;
  irrPercentage: number | null;
  profitabilityIndex: number | null;
  projection: CashFlowProjection;
}

export interface ForecastComparisonRow {
  key: string;
  label: string;
  unit: "currency" | "percentage" | "count";
  withoutInvestment: number | null;
  withInvestment: number | null;
  upliftPercentage: number | null;
}
