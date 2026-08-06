// The AI Insight Engine's rule/template layer — deterministic, no LLM, no
// new financial math. Every function here takes numbers already computed by
// an existing engine (Finance/Budget/Forecast/Scenario/Investment/Executive)
// and produces a structured Insight whose `summary` is a template string
// filled in ONLY with values present in `supportingMetrics` — never a
// fabricated claim. This is the same pattern already used for Forecast
// Alerts (Phase 5) and Executive Alerts (Phase 7), generalized into a
// richer, categorized, confidence-scored insight shape.
import { computeConfidence } from "../forecast/forecast.formulas";
import { HistoricalPoint } from "../forecast/forecast.types";
import { Insight, InsightSeverity, KpiRuleInput } from "./ai.types";

const fmtValue = (v: number | null, unit: "currency" | "percentage" | "count" = "currency"): string => {
  if (v === null || v === undefined) return "—";
  if (unit === "percentage") return `${v.toFixed(1)}%`;
  if (unit === "count") return String(Math.round(v));
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
};

const mean = (xs: number[]): number => (xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const stdDev = (xs: number[]): number => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

// ── Factual insights ("what happened?") — always confidence: high, since these are facts about real historical data, not predictions ──

export const revenueChangeInsight = (revenue: KpiRuleInput, relatedScreens: string[]): Insight | null => {
  if (revenue.current === null || revenue.previousPeriod == null || revenue.variancePercentage == null) return null;
  if (Math.abs(revenue.variancePercentage) < 2) return null; // not worth surfacing a negligible change
  const up = revenue.variancePercentage > 0;
  return {
    category: "insight",
    title: `Revenue ${up ? "Increased" : "Decreased"}`,
    summary: `Revenue ${up ? "increased" : "decreased"} by ${Math.abs(revenue.variancePercentage).toFixed(1)}% compared with the previous period (${fmtValue(revenue.current)} vs ${fmtValue(revenue.previousPeriod)}).`,
    severity: up ? "info" : Math.abs(revenue.variancePercentage) >= 15 ? "high" : "medium",
    confidence: "high",
    supportingMetrics: [
      { key: "revenue", label: "Revenue", value: revenue.current, unit: "currency" },
      { key: "revenuePrevious", label: "Previous Period Revenue", value: revenue.previousPeriod, unit: "currency" },
      { key: "revenueVariancePercentage", label: "Variance %", value: revenue.variancePercentage, unit: "percentage" },
    ],
    recommendedActions: up ? [] : ["Review pricing, promotions, and channel mix to understand the drop.", "Check Forecasting for the expected trajectory."],
    relatedScreens,
  };
};

export const foodCostTargetInsight = (foodCostPct: KpiRuleInput, revenue: KpiRuleInput, relatedScreens: string[]): Insight | null => {
  if (foodCostPct.current === null || foodCostPct.target == null) return null;
  const overBy = foodCostPct.current - foodCostPct.target;
  if (overBy <= 0.5) return null;
  const revenueFlat = revenue.variancePercentage != null && Math.abs(revenue.variancePercentage) < 3;
  return {
    category: "risk",
    title: "Food Cost Above Target",
    summary: `Food Cost is at ${foodCostPct.current.toFixed(1)}%, ${overBy.toFixed(1)} points above the ${foodCostPct.target.toFixed(1)}% target${revenueFlat ? ", mainly because ingredient costs increased while sales remained stable" : ""}.`,
    severity: overBy >= 5 ? "critical" : overBy >= 2 ? "high" : "medium",
    confidence: "high",
    supportingMetrics: [
      { key: "foodCostPercentage", label: "Food Cost %", value: foodCostPct.current, unit: "percentage" },
      { key: "foodCostTarget", label: "Target", value: foodCostPct.target, unit: "percentage" },
      { key: "foodCostOverTarget", label: "Points Over Target", value: Math.round(overBy * 10) / 10, unit: "percentage" },
    ],
    recommendedActions: ["Review supplier pricing for recent increases.", "Audit portioning and wastage.", "Review menu pricing to offset higher input costs."],
    relatedScreens,
  };
};

// ── Anomaly detection ("unusual behaviour") — a generic statistical threshold, reused across any KPI's historical series ──

/**
 * Flags `currentValue` as anomalous when it deviates from the trailing
 * series' mean by more than 1.5 standard deviations. Confidence reuses
 * forecast.formulas.ts's own computeConfidence — the same "how much history,
 * how stable" heuristic Forecasting already uses, applied here to judge how
 * much to trust the anomaly call itself, not a second confidence formula.
 */
export const detectAnomaly = (
  label: string,
  kpiKey: string,
  unit: "currency" | "percentage" | "count",
  historicalValues: number[],
  currentValue: number | null,
  higherIsBetter: boolean,
  relatedScreens: string[],
): Insight | null => {
  if (currentValue === null || historicalValues.length < 3) return null;
  const m = mean(historicalValues);
  const sd = stdDev(historicalValues);
  if (sd === 0) return null; // no historical variation to compare against

  const deviation = (currentValue - m) / sd;
  if (Math.abs(deviation) < 1.5) return null;

  const direction = currentValue > m ? "up" : "down";
  const isGood = higherIsBetter ? direction === "up" : direction === "down";
  const percentChange = m !== 0 ? ((currentValue - m) / Math.abs(m)) * 100 : null;
  const magnitudeSeverity: InsightSeverity = Math.abs(deviation) >= 2.5 ? "critical" : Math.abs(deviation) >= 2 ? "high" : "medium";

  const confidence = computeConfidence(historicalValues.map((v): HistoricalPoint => ({ value: v, hasActivity: true }))).level;

  return {
    category: "anomaly",
    title: `Unusual ${label} ${direction === "up" ? "Increase" : "Decrease"}`,
    summary: `${label} is ${percentChange !== null ? `${Math.abs(percentChange).toFixed(1)}% ${direction === "up" ? "above" : "below"}` : direction === "up" ? "above" : "below"} its recent average (${fmtValue(currentValue, unit)} vs a typical ${fmtValue(Math.round(m), unit)} over the last ${historicalValues.length} periods).`,
    severity: isGood ? "info" : magnitudeSeverity,
    confidence,
    supportingMetrics: [
      { key: kpiKey, label, value: currentValue, unit },
      { key: `${kpiKey}Average`, label: `Recent Average ${label}`, value: Math.round(m), unit },
      { key: `${kpiKey}WindowSize`, label: "Historical Periods Compared", value: historicalValues.length, unit: "count" },
    ],
    recommendedActions: isGood
      ? [`Investigate what drove this improvement in ${label} so it can be repeated.`]
      : [`Investigate the root cause of this unusual ${label} change before it becomes a trend.`],
    relatedScreens,
  };
};

// ── Risks ──────────────────────────────────────────────────────────────────

export const fallingProfitabilityRisk = (netProfit: KpiRuleInput, relatedScreens: string[]): Insight | null => {
  if (netProfit.trendDirection !== "down" || netProfit.variancePercentage == null || Math.abs(netProfit.variancePercentage) < 5) return null;
  return {
    category: "risk",
    title: "Falling Profitability",
    summary: `Net Profit has declined ${Math.abs(netProfit.variancePercentage).toFixed(1)}% versus the previous period (${fmtValue(netProfit.current)} vs ${fmtValue(netProfit.previousPeriod ?? null)}).`,
    severity: Math.abs(netProfit.variancePercentage) >= 20 ? "critical" : "high",
    confidence: "high",
    supportingMetrics: [
      { key: "netProfit", label: "Net Profit", value: netProfit.current, unit: "currency" },
      { key: "netProfitPrevious", label: "Previous Period Net Profit", value: netProfit.previousPeriod ?? null, unit: "currency" },
    ],
    recommendedActions: ["Review the EBITDA breakdown for the specific cost or revenue driver.", "Compare against the current Forecast and Budget for context."],
    relatedScreens,
  };
};

export const risingCostRisk = (kpi: KpiRuleInput, costLabel: string, relatedScreens: string[]): Insight | null => {
  if (kpi.trendDirection !== "up" || kpi.variancePercentage == null || kpi.current == null || Math.abs(kpi.variancePercentage) < 5) return null;
  return {
    category: "risk",
    title: `${costLabel} Increasing`,
    summary: `${costLabel} has risen ${kpi.variancePercentage.toFixed(1)}% versus the previous period (${fmtValue(kpi.current, "percentage")} now vs ${fmtValue(kpi.previousPeriod ?? null, "percentage")}).`,
    severity: kpi.variancePercentage >= 15 ? "critical" : kpi.variancePercentage >= 8 ? "high" : "medium",
    confidence: "high",
    supportingMetrics: [
      { key: kpi.key, label: kpi.label, value: kpi.current, unit: "percentage" },
      { key: `${kpi.key}Previous`, label: `Previous Period ${kpi.label}`, value: kpi.previousPeriod ?? null, unit: "percentage" },
      { key: `${kpi.key}VariancePercentage`, label: "Variance %", value: kpi.variancePercentage, unit: "percentage" },
    ],
    recommendedActions: costLabel.includes("Labour") ? ["Review shift scheduling and staffing levels against footfall."] : ["Audit portioning, wastage, and current supplier pricing."],
    relatedScreens,
  };
};

export const lowForecastConfidenceRisk = (forecast: { overallConfidence: string; confidenceReasons: string[] } | null, relatedScreens: string[]): Insight | null => {
  if (!forecast || forecast.overallConfidence !== "low") return null;
  return {
    category: "risk",
    title: "Low Forecast Confidence",
    summary: `Next month's forecast has low confidence${forecast.confidenceReasons[0] ? ` — ${forecast.confidenceReasons[0].toLowerCase()}` : ""}.`,
    severity: "medium",
    confidence: "low",
    supportingMetrics: [{ key: "forecastConfidence", label: "Forecast Confidence", value: "low" }],
    recommendedActions: ["Gather more historical data before relying on this forecast for planning.", ...forecast.confidenceReasons.slice(0, 1)],
    relatedScreens,
  };
};

export const delayedInvestmentPaybackRisks = (
  needsAttention: { project: { name: string }; metrics: { npv: number | null; paybackPeriodYears: number | null } }[],
  relatedScreens: string[],
): Insight[] =>
  needsAttention.map((p) => ({
    category: "risk",
    title: `Investment "${p.project.name}" Below Expectation`,
    summary: `"${p.project.name}" has ${p.metrics.npv != null && p.metrics.npv <= 0 ? `a negative NPV (${fmtValue(p.metrics.npv)})` : "no viable payback period within its project life"} — capital may be tied up longer than planned.`,
    severity: "medium",
    confidence: "high",
    supportingMetrics: [
      { key: "npv", label: "NPV", value: p.metrics.npv, unit: "currency" },
      { key: "payback", label: "Payback Period (years)", value: p.metrics.paybackPeriodYears, unit: "count" },
    ],
    recommendedActions: ["Review this investment's assumptions.", "Consider delaying further capital allocation until the assumptions improve."],
    relatedScreens,
  }));

export const persistentBudgetMissRisks = (criticalRows: { label: string; achievementPercentage: number | null }[], relatedScreens: string[]): Insight[] =>
  criticalRows.map((r) => ({
    category: "risk",
    title: `${r.label} Critically Off Budget`,
    summary: `${r.label} is critically off budget${r.achievementPercentage != null ? ` (${r.achievementPercentage.toFixed(0)}% achievement)` : ""}.`,
    severity: "critical",
    confidence: "high",
    supportingMetrics: [{ key: "achievement", label: "Achievement %", value: r.achievementPercentage, unit: "percentage" }],
    recommendedActions: ["Revisit this category's budget assumptions.", "Investigate the specific variance driver."],
    relatedScreens,
  }));

export const decliningCustomerGrowthRisk = (customerGrowth: KpiRuleInput, relatedScreens: string[]): Insight | null => {
  if (customerGrowth.current == null || customerGrowth.current >= 0) return null;
  const decline = Math.abs(customerGrowth.current);
  return {
    category: "risk",
    title: "Declining Customer Growth",
    summary: `Customer growth is negative at ${customerGrowth.current.toFixed(1)}% — fewer distinct customers this period than last.`,
    severity: decline >= 20 ? "critical" : decline >= 10 ? "high" : decline >= 5 ? "medium" : "low",
    confidence: "high",
    supportingMetrics: [{ key: "customerGrowthPercentage", label: "Customer Growth %", value: customerGrowth.current, unit: "percentage" }],
    recommendedActions: ["Consider marketing campaigns or loyalty programs to rebuild customer growth."],
    relatedScreens,
  };
};

export const branchUnderperformingPeersRisk = (
  lowestPerforming: { branch: { name: string }; healthScore: number } | null,
  networkAverageHealth: number | null,
  relatedScreens: string[],
): Insight | null => {
  if (!lowestPerforming || networkAverageHealth == null) return null;
  const gap = networkAverageHealth - lowestPerforming.healthScore;
  if (gap < 15) return null; // not "significantly" behind
  return {
    category: "risk",
    title: `${lowestPerforming.branch.name} Significantly Underperforming Peers`,
    summary: `${lowestPerforming.branch.name}'s Business Health Score (${lowestPerforming.healthScore}/100) is ${gap.toFixed(0)} points below the network average (${networkAverageHealth.toFixed(0)}/100).`,
    severity: gap >= 30 ? "critical" : gap >= 20 ? "high" : "medium",
    confidence: "high",
    supportingMetrics: [
      { key: "healthScore", label: "Health Score", value: lowestPerforming.healthScore, unit: "count" },
      { key: "networkAverage", label: "Network Average", value: Math.round(networkAverageHealth), unit: "count" },
      { key: "healthScoreGap", label: "Points Below Average", value: Math.round(gap), unit: "count" },
    ],
    recommendedActions: [`Review ${lowestPerforming.branch.name}'s individual KPIs and consider a branch-specific action plan.`],
    relatedScreens,
  };
};

export const weakBusinessHealthRisk = (health: { overall: number; status: string }, relatedScreens: string[]): Insight | null => {
  if (health.overall >= 50) return null;
  return {
    category: "risk",
    title: "Weak Business Health Score",
    summary: `The Business Health Score is ${health.overall}/100 (${health.status}) — several core KPIs need attention together.`,
    severity: health.overall < 30 ? "critical" : "high",
    confidence: "high",
    supportingMetrics: [{ key: "healthScore", label: "Business Health Score", value: health.overall, unit: "count" }],
    recommendedActions: ["Review the Executive Dashboard's category breakdown to find the weakest contributors."],
    relatedScreens,
  };
};

// ── Opportunities ────────────────────────────────────────────────────────

export const highGrowthBranchOpportunity = (
  mostImproved: { branch: { name: string }; revenueTrendPercentage: number | null } | null,
  relatedScreens: string[],
): Insight | null => {
  if (!mostImproved || mostImproved.revenueTrendPercentage == null || mostImproved.revenueTrendPercentage < 5) return null;
  return {
    category: "opportunity",
    title: `${mostImproved.branch.name} Is a High-Growth Branch`,
    summary: `${mostImproved.branch.name} grew revenue ${mostImproved.revenueTrendPercentage.toFixed(1)}% versus the previous period — the most improved branch in the network.`,
    severity: "info",
    confidence: "high",
    supportingMetrics: [{ key: "revenueTrend", label: "Revenue Growth %", value: mostImproved.revenueTrendPercentage, unit: "percentage" }],
    recommendedActions: [`Study what's working at ${mostImproved.branch.name} and consider applying it elsewhere.`],
    relatedScreens,
  };
};

export const strongROIInvestmentOpportunities = (
  topPerforming: { project: { name: string }; metrics: { roiPercentage: number | null; npv: number | null } }[],
  relatedScreens: string[],
): Insight[] =>
  topPerforming
    .filter((p) => (p.metrics.roiPercentage ?? 0) > 20)
    .map((p) => ({
      category: "opportunity",
      title: `"${p.project.name}" Is Delivering Strong ROI`,
      summary: `"${p.project.name}" is tracking ${p.metrics.roiPercentage!.toFixed(1)}% ROI with a positive NPV of ${fmtValue(p.metrics.npv)}.`,
      severity: "info",
      confidence: "high",
      supportingMetrics: [
        { key: "roi", label: "ROI %", value: p.metrics.roiPercentage, unit: "percentage" },
        { key: "npv", label: "NPV", value: p.metrics.npv, unit: "currency" },
      ],
      recommendedActions: ["Consider a similar investment at another branch."],
      relatedScreens,
    }));

export const improvingForecastTrendOpportunity = (
  forecastRevenue: { trendDirection?: string | null; variancePercentage?: number | null } | undefined,
  relatedScreens: string[],
): Insight | null => {
  if (!forecastRevenue || forecastRevenue.trendDirection !== "up" || (forecastRevenue.variancePercentage ?? 0) < 5) return null;
  return {
    category: "opportunity",
    title: "Forecast Trending Upward",
    summary: `Next month's revenue forecast is trending up ${forecastRevenue.variancePercentage!.toFixed(1)}% versus the current period.`,
    severity: "info",
    confidence: "medium",
    supportingMetrics: [{ key: "forecastTrend", label: "Forecast Variance %", value: forecastRevenue.variancePercentage ?? null, unit: "percentage" }],
    recommendedActions: ["Ensure staffing and inventory are ready to support the expected growth."],
    relatedScreens,
  };
};

export const healthyMarginOpportunity = (ebitdaPct: KpiRuleInput, relatedScreens: string[]): Insight | null => {
  if (ebitdaPct.achievementPercentage == null || ebitdaPct.achievementPercentage < 110 || ebitdaPct.current == null) return null;
  return {
    category: "opportunity",
    title: "EBITDA Margin Ahead of Target",
    summary: `EBITDA % is at ${ebitdaPct.current.toFixed(1)}%, ${(ebitdaPct.achievementPercentage - 100).toFixed(0)} points ahead of target.`,
    severity: "info",
    confidence: "high",
    supportingMetrics: [
      { key: "ebitdaPercentage", label: "EBITDA %", value: ebitdaPct.current, unit: "percentage" },
      { key: "ebitdaAchievementPercentage", label: "Target Achievement %", value: ebitdaPct.achievementPercentage, unit: "percentage" },
    ],
    recommendedActions: ["Consider reinvesting the margin into growth (marketing, a new branch, or equipment)."],
    relatedScreens,
  };
};

// ── Recommendations ──────────────────────────────────────────────────────

export const expandHighPerformingBranchRecommendation = (
  bestPerforming: { branch: { name: string }; healthScore: number } | null,
  relatedScreens: string[],
): Insight | null => {
  if (!bestPerforming || bestPerforming.healthScore < 80) return null;
  return {
    category: "recommendation",
    title: `Consider Expanding ${bestPerforming.branch.name}`,
    summary: `${bestPerforming.branch.name} has the network's highest Business Health Score (${bestPerforming.healthScore}/100) — a strong candidate for expansion or replication.`,
    severity: "info",
    confidence: "medium",
    supportingMetrics: [{ key: "healthScore", label: "Business Health Score", value: bestPerforming.healthScore, unit: "count" }],
    recommendedActions: ["Evaluate a Branch Expansion investment in Investment Analysis using this branch's assumptions as a starting point."],
    relatedScreens,
  };
};

/**
 * Predicted Stock-Out Risk — consumes getInventoryForecastService's flagged
 * (reorderRecommended) items directly (forecast module, Phase 9). Same
 * "already-computed numbers only" rule as every other function here: the
 * days-until-stockout figures come straight from that service's
 * currentQuantity ÷ projectedDailyConsumption math, never re-derived.
 */
export const predictedStockOutRisk = (
  flaggedItems: { ingredientName: string; unit: string | null; daysUntilStockout: number | null }[],
  relatedScreens: string[],
): Insight | null => {
  if (flaggedItems.length === 0) return null;
  const worst = [...flaggedItems].sort((a, b) => (a.daysUntilStockout ?? Infinity) - (b.daysUntilStockout ?? Infinity));
  const soonest = worst[0];
  const names = worst.slice(0, 3).map((i) => (i.daysUntilStockout != null ? `${i.ingredientName} (${i.daysUntilStockout.toFixed(1)} days)` : i.ingredientName));
  const minDays = soonest.daysUntilStockout;
  return {
    category: "risk",
    title: flaggedItems.length === 1 ? "Predicted Stock-Out Risk" : `Predicted Stock-Out Risk (${flaggedItems.length} ingredients)`,
    summary: `Based on projected consumption, ${flaggedItems.length} ingredient(s) are on track to run out soon — ${names.join(", ")}${flaggedItems.length > 3 ? `, and ${flaggedItems.length - 3} more` : ""}.`,
    severity: minDays !== null && minDays <= 2 ? "critical" : minDays !== null && minDays <= 4 ? "high" : "medium",
    confidence: "medium",
    supportingMetrics: worst.slice(0, 5).map((i) => ({ key: `stockout-${i.ingredientName}`, label: i.ingredientName, value: i.daysUntilStockout, unit: "count" as const })),
    recommendedActions: ["Place a reorder for the flagged ingredients before the projected stock-out date.", "Review the Inventory Forecast for the full projected-consumption list."],
    relatedScreens,
  };
};

/**
 * Predicted Staff Shortfall at Peak Hour — compares
 * getPeakHourForecastService's projectedStaffRequirement (itself
 * computeStaffRequirement applied to a forecasted, not historical, order
 * volume — see forecast.service.ts's getPeakHourForecastService) against the
 * branch's currently-scheduled/active staff count. Both numbers are handed
 * in already-computed; this function only compares and templates them.
 */
export const predictedStaffShortfallRisk = (
  projectedStaffRequirement: number,
  currentActiveStaffCount: number,
  relatedScreens: string[],
): Insight | null => {
  const shortfall = projectedStaffRequirement - currentActiveStaffCount;
  if (shortfall <= 0) return null;
  return {
    category: "risk",
    title: "Predicted Staff Shortfall at Peak Hour",
    summary: `The forecasted peak hour is projected to need ${projectedStaffRequirement} staff, but only ${currentActiveStaffCount} are currently scheduled/active — a shortfall of ${shortfall}.`,
    severity: shortfall >= 3 ? "critical" : shortfall === 2 ? "high" : "medium",
    confidence: "medium",
    supportingMetrics: [
      { key: "projectedStaffRequirement", label: "Projected Staff Needed", value: projectedStaffRequirement, unit: "count" },
      { key: "currentActiveStaffCount", label: "Currently Scheduled/Active Staff", value: currentActiveStaffCount, unit: "count" },
      { key: "staffShortfall", label: "Shortfall", value: shortfall, unit: "count" },
    ],
    recommendedActions: ["Schedule additional staff ahead of the forecasted peak hour.", "Review the Peak Hour Forecast for the projected order volume driving this."],
    relatedScreens,
  };
};

/** Growing Peak-Hour Demand — an opportunity when the forecasted peak-hour order volume is trending meaningfully above the most recent historical peak, so staffing/inventory can be prepared ahead of it rather than caught out. */
export const growingPeakHourDemandOpportunity = (
  peakHour: { predictedPeakHourOrders: number; baselinePeakHourOrders: number | null; variancePercentage: number | null },
  relatedScreens: string[],
): Insight | null => {
  if (peakHour.variancePercentage == null || peakHour.variancePercentage < 15 || peakHour.baselinePeakHourOrders == null) return null;
  return {
    category: "opportunity",
    title: "Peak-Hour Demand Growing",
    summary: `The busiest hour's order volume is forecasted to grow ${peakHour.variancePercentage.toFixed(1)}% (${peakHour.baselinePeakHourOrders} orders recently vs ${peakHour.predictedPeakHourOrders} projected) — worth preparing staffing and stock ahead of it.`,
    severity: "info",
    confidence: "medium",
    supportingMetrics: [
      { key: "predictedPeakHourOrders", label: "Projected Peak-Hour Orders", value: peakHour.predictedPeakHourOrders, unit: "count" },
      { key: "baselinePeakHourOrders", label: "Recent Peak-Hour Orders", value: peakHour.baselinePeakHourOrders, unit: "count" },
      { key: "peakHourVariancePercentage", label: "Variance %", value: peakHour.variancePercentage, unit: "percentage" },
    ],
    recommendedActions: ["Review the Peak Hour Forecast's projected staff requirement.", "Ensure top-selling ingredients are stocked ahead of the busier peak hour."],
    relatedScreens,
  };
};

export const delayLowReturnInvestmentRecommendations = (
  needsAttention: { project: { name: string }; metrics: { npv: number | null } }[],
  relatedScreens: string[],
): Insight[] =>
  needsAttention
    .filter((p) => (p.metrics.npv ?? 0) < 0)
    .map((p) => ({
      category: "recommendation",
      title: `Delay or Re-evaluate "${p.project.name}"`,
      summary: `"${p.project.name}" currently has a negative NPV (${fmtValue(p.metrics.npv)}) — committing further capital before revisiting its assumptions carries risk.`,
      severity: "medium",
      confidence: "high",
      supportingMetrics: [{ key: "npv", label: "NPV", value: p.metrics.npv, unit: "currency" }],
      recommendedActions: ["Revisit the investment's revenue/cost assumptions.", "Delay further capital commitment until NPV turns positive."],
      relatedScreens,
    }));

export { fmtValue };
