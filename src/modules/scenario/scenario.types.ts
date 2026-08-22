export type ScenarioTypeValue = "CONSERVATIVE" | "EXPECTED" | "OPTIMISTIC" | "CUSTOM";

// Every field a scenario can override. Split into three groups matching the
// schema comment: what-if deltas with no steady-state equivalent, absolute ₹
// overrides of actual expense figures, and rate/target overrides that mirror
// FinancialAssumptions field names 1:1 (a scenario "inherits" from the
// resolved assumptions for any of these it doesn't set).
export const SCENARIO_OVERRIDE_FIELDS = [
  "revenueGrowthPercentage",
  "orderGrowthPercentage",
  "avgOrderValue",
  "rent",
  "utilities",
  "marketing",
  "maintenance",
  "packaging",
  "foodCostTargetPercentage",
  "labourTargetPercentage",
  "deliveryPercentage",
  "swiggyCommissionPercentage",
  "zomatoCommissionPercentage",
  "royaltyPercentage",
  "franchiseFeePercentage",
  "salaryIncrementPercentage",
  "inflationPercentage",
  "rentEscalationPercentage",
  "workingDays",
  "businessHours",
] as const;

export type ScenarioOverrideField = (typeof SCENARIO_OVERRIDE_FIELDS)[number];

export type ScenarioOverrides = Partial<Record<ScenarioOverrideField, number | null>>;

export const BUILT_IN_SCENARIOS: { type: ScenarioTypeValue; name: string; description: string; overrides: ScenarioOverrides }[] = [
  {
    type: "CONSERVATIVE",
    name: "Conservative",
    description: "Cautious outlook — flat-to-declining revenue, costs trend slightly worse than today.",
    overrides: { revenueGrowthPercentage: -5, orderGrowthPercentage: -5 },
  },
  {
    type: "EXPECTED",
    name: "Expected",
    description: "Business continues at today's run rate — no growth assumed, no overrides.",
    overrides: {},
  },
  {
    type: "OPTIMISTIC",
    name: "Optimistic",
    description: "Growth outlook — revenue and orders both trend up.",
    overrides: { revenueGrowthPercentage: 10, orderGrowthPercentage: 10 },
  },
];

export type ProjectedKpiUnit = "currency" | "percentage" | "count";

export interface ProjectedKpiRow {
  key: string;
  label: string;
  unit: ProjectedKpiUnit;
  higherIsBetter: boolean;
  baseline: number | null;
  projected: number | null;
  variance: number | null;
  variancePercentage: number | null;
  achievementPercentage: number | null;
  trendDirection: "up" | "down" | "flat" | null;
}

export interface WhatIfResult {
  scenarioId: number;
  restaurantId: number;
  branchId: number | null;
  period: string;
  startDate: string;
  endDate: string;
  kpis: ProjectedKpiRow[];
  /** The real value in effect for each override field when left blank — see runWhatIfService's own comment for the per-field fallback rules this mirrors. */
  currentValues: Record<ScenarioOverrideField, number | null>;
}
