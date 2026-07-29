export type HealthStatus = "excellent" | "good" | "warning" | "critical";
export type CategoryStatus = HealthStatus | "no-data";

export interface HealthCategoryInput {
  key: string;
  label: string;
  /** An achievement-style score, 0-100+ (may exceed 100 when beating target) — clamped before weighting. Null when the underlying data isn't available yet (e.g. no published budget), not to be confused with a real 0. */
  score: number | null;
  weight: number;
}

export interface HealthCategoryResult extends HealthCategoryInput {
  clampedScore: number | null;
  /** This category's actual contribution to the overall score, after re-normalizing weights across only the categories that had data. */
  contribution: number;
  status: CategoryStatus;
}

export interface BusinessHealthScoreResult {
  overall: number;
  status: HealthStatus;
  categories: HealthCategoryResult[];
  suggestions: string[];
}

export interface KpiScorecardRow {
  key: string;
  label: string;
  unit: "currency" | "percentage" | "count";
  higherIsBetter: boolean;
  current: number | null;
  target: number | null;
  previousPeriod: number | null;
  budget: number | null;
  forecast: number | null;
  achievementPercentage: number | null;
  trendDirection: "up" | "down" | "flat" | null;
  /** "no-data" is a legitimate, common state — not every scorecard KPI (e.g. Branch Count, Inventory Value) has a natural target to measure achievement against. */
  status: CategoryStatus;
}

export interface ExecutiveAlert {
  key: string;
  severity: "critical" | "warning" | "info";
  message: string;
  impact: string;
  recommendedAction: string;
  linkTo: string;
}
