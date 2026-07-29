// The Business Health Score — the one genuinely new calculation this phase
// introduces (everything else composes existing engines). A simple,
// transparent, documented weighted average, not a black-box model: every
// category's score is an achievement-style percentage the Finance/Budget/
// Forecast/Investment engines already compute, clamped to 0-100 and
// weighted. No financial formula is re-derived here.
import { BusinessHealthScoreResult, CategoryStatus, HealthCategoryInput, HealthStatus } from "./executive.types";

/** Sums to 1.0 — configurable per call (see computeBusinessHealthScore's `weights` param); this is only the documented default. */
export const DEFAULT_HEALTH_WEIGHTS: Record<string, number> = {
  revenueAchievement: 0.15,
  ebitda: 0.15,
  netProfit: 0.10,
  foodCost: 0.15,
  labourCost: 0.10,
  primeCost: 0.10,
  forecastAccuracy: 0.05,
  budgetAchievement: 0.10,
  customerGrowth: 0.05,
  branchPerformance: 0.05,
};

const SUGGESTIONS: Record<string, string> = {
  revenueAchievement: "Revenue is trailing its target — review pricing, upsell strategy, and marketing spend.",
  ebitda: "EBITDA is below target — look for revenue growth and cost-control opportunities together.",
  netProfit: "Net Profit is under target — check finance costs and non-operating expenses alongside EBITDA.",
  foodCost: "Food Cost % is above target — review portioning, wastage, and supplier pricing.",
  labourCost: "Labour Cost % is above target — review staffing levels against actual footfall.",
  primeCost: "Prime Cost % is above target — the combined Food + Labour cost needs attention.",
  forecastAccuracy: "Recent forecasts have been less accurate than expected — treat projections with more caution until this improves.",
  budgetAchievement: "Actuals are diverging from budget — revisit assumptions or investigate the variance drivers.",
  customerGrowth: "Customer growth has slowed — consider marketing campaigns or loyalty programs.",
  branchPerformance: "One or more branches are underperforming — see the Multi-Branch view for details.",
};

export const clampScore = (value: number | null): number | null => (value === null ? null : Math.max(0, Math.min(100, value)));

export const statusForScore = (score: number | null): CategoryStatus => {
  if (score === null) return "no-data";
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "warning";
  return "critical";
};

/**
 * Weighted average of every category's clamped 0-100 score. A category with
 * no data (score === null, e.g. no published budget yet) is excluded from
 * the weighted average entirely — its weight is redistributed across the
 * remaining categories rather than counted as a 0, so a restaurant that
 * simply hasn't set up Budgets yet isn't penalized as if it were performing
 * badly at budgeting. The overall score falls back to 0 ("critical") only
 * when literally every category is unmeasurable — a genuine data-availability
 * problem worth flagging, not a real performance judgement.
 */
export const computeBusinessHealthScore = (categories: HealthCategoryInput[]): BusinessHealthScoreResult => {
  const clamped = categories.map((c) => ({ ...c, clampedScore: clampScore(c.score) }));
  const available = clamped.filter((c) => c.clampedScore !== null);
  const totalAvailableWeight = available.reduce((s, c) => s + c.weight, 0);

  const results = clamped.map((c) => {
    const normalizedWeight = totalAvailableWeight > 0 && c.clampedScore !== null ? c.weight / totalAvailableWeight : 0;
    const contribution = c.clampedScore !== null ? Math.round(c.clampedScore * normalizedWeight * 10) / 10 : 0;
    return { ...c, contribution, status: statusForScore(c.clampedScore) };
  });

  const overall = available.length > 0 ? Math.round(results.reduce((s, c) => s + c.contribution, 0)) : 0;
  const suggestions = results
    .filter((c) => c.clampedScore !== null && c.clampedScore < 70)
    .sort((a, b) => a.clampedScore! - b.clampedScore!)
    .slice(0, 5)
    .map((c) => SUGGESTIONS[c.key] || `${c.label} needs attention.`);

  return { overall, status: statusForScore(overall) as HealthStatus, categories: results, suggestions };
};
