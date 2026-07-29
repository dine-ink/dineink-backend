export type InsightCategory = "insight" | "anomaly" | "recommendation" | "risk" | "opportunity";
export type InsightSeverity = "info" | "low" | "medium" | "high" | "critical";
export type ConfidenceLevel = "high" | "medium" | "low";

export interface SupportingMetric {
  key: string;
  label: string;
  value: number | string | null;
  unit?: "currency" | "percentage" | "count";
}

/**
 * One structured business insight. `summary` is always a template string
 * filled in with real numbers already present in `supportingMetrics` — never
 * free text invented independently of those numbers (see ai.rules.ts's
 * header comment for the traceability rule this file enforces).
 */
export interface Insight {
  category: InsightCategory;
  title: string;
  summary: string;
  severity: InsightSeverity;
  confidence: ConfidenceLevel;
  supportingMetrics: SupportingMetric[];
  recommendedActions: string[];
  relatedScreens: string[];
}

export interface BranchNarrative {
  branchId: number;
  branchName: string;
  narrative: string;
  strengths: string[];
  risks: string[];
  opportunities: string[];
  healthScore: number;
}

export interface ExecutiveBrief {
  generatedAt: string;
  businessHealth: { overall: number; status: string };
  biggestWins: Insight[];
  biggestRisks: Insight[];
  budgetPerformance: string;
  forecastSummary: string;
  investmentUpdates: string;
  branchRankings: { name: string; healthScore: number }[];
  immediatePriorities: string[];
}

export interface ConversationalAnswer {
  question: string;
  answer: string;
  supportingMetrics: SupportingMetric[];
  relatedScreens: string[];
}

/** A single KPI's already-computed comparison data — the exact shape Executive's own Overview/Scorecard rows already have (see executive.types.ts's KpiScorecardRow); reused here as the rule engine's raw input, never re-derived. */
export interface KpiRuleInput {
  key: string;
  label: string;
  unit: "currency" | "percentage" | "count";
  higherIsBetter: boolean;
  current: number | null;
  previousPeriod?: number | null;
  variance?: number | null;
  variancePercentage?: number | null;
  trendDirection?: "up" | "down" | "flat" | null;
  target?: number | null;
  achievementPercentage?: number | null;
  status?: string;
}
