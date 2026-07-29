// AI Financial Advisor & Intelligent Insights — a pure composition + rules
// layer. NOT another financial calculation engine: every number quoted in an
// insight, brief, narrative, or conversational answer comes from an existing
// engine call (Finance/Budget/Scenario/Forecast/Investment/Executive),
// unmodified. ai.rules.ts turns those already-computed numbers into
// structured, templated natural-language Insights; this file's only job is
// fetching the right existing data and handing it to those rules — plus a
// lightweight, idempotent audit log so the "Historical Insight Timeline"
// (spec section 10) has something to show. No LLM is called anywhere here —
// see the module's report for why, and how a future LLM would plug in.
import prisma from "../../config/prisma";
import { PeriodKey } from "../../utils/dateRange";
import { getBudgetVarianceService, listBudgetsService } from "../budget/budget.service";
import { generateForecastService } from "../forecast/forecast.service";
import {
  getBusinessHealthScoreService,
  getExecutiveOverviewService,
  getExecutiveTimelineService,
  getInsightPanelsService,
  getMultiBranchExecutiveViewService,
} from "../executive/executive.service";
import { listInvestmentsWithMetricsService, getPortfolioSummaryService } from "../investment/investment.service";
import { listScenariosService, runWhatIfService } from "../scenario/scenario.service";
import {
  branchUnderperformingPeersRisk,
  decliningCustomerGrowthRisk,
  delayedInvestmentPaybackRisks,
  delayLowReturnInvestmentRecommendations,
  detectAnomaly,
  expandHighPerformingBranchRecommendation,
  fallingProfitabilityRisk,
  fmtValue,
  foodCostTargetInsight,
  healthyMarginOpportunity,
  highGrowthBranchOpportunity,
  improvingForecastTrendOpportunity,
  lowForecastConfidenceRisk,
  persistentBudgetMissRisks,
  revenueChangeInsight,
  risingCostRisk,
  strongROIInvestmentOpportunities,
  weakBusinessHealthRisk,
} from "./ai.rules";
import { BranchNarrative, ConversationalAnswer, ExecutiveBrief, Insight } from "./ai.types";

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

// ── The Insight Engine (spec section 1) ──────────────────────────────────

export const generateInsightsService = async (
  restaurantId: number,
  branchId: number | null,
  period: PeriodKey,
  from?: string,
  to?: string,
): Promise<Insight[]> => {
  // getExecutiveTimelineService is run on its own, after the rest, rather than
  // stacked into the same Promise.all — it already fans out internally into
  // 12 concurrent per-month queries (Phase 7), and piling 4 more heavy calls
  // on top of that under a fixed-size connection pool is what was causing
  // real-restaurant-scale connection-timeout failures during Phase 8
  // verification. Splitting the batch fixed it without touching Phase 7's
  // own Timeline implementation.
  // overview is fetched first (not inside the Promise.all below) so
  // getBusinessHealthScoreService can reuse it instead of recomputing the
  // same ~8-query overview a second time.
  const overview = await getExecutiveOverviewService(restaurantId, branchId, period, from, to);
  const [health, forecast, portfolio] = await Promise.all([
    getBusinessHealthScoreService(restaurantId, branchId, period, from, to, overview),
    generateForecastService(restaurantId, branchId, "NEXT_MONTH", "HISTORICAL_TREND", undefined, false),
    getPortfolioSummaryService(restaurantId, { branchId }),
  ]);
  const timeline = await getExecutiveTimelineService(restaurantId, branchId, "monthly");
  const byKey = Object.fromEntries(overview.kpis.map((r: any) => [r.key, r]));

  const budgets = await listBudgetsService(restaurantId, { branchId: branchId ?? undefined, status: "PUBLISHED" });
  let budgetCriticalRows: any[] = [];
  if (budgets[0]) {
    const variance = await getBudgetVarianceService(restaurantId, budgets[0].id, period, from, to);
    budgetCriticalRows = variance.rows.filter((r: any) => r.status === "critical");
  }

  let multiBranch: any = null;
  if (branchId === null) multiBranch = await getMultiBranchExecutiveViewService(restaurantId, period, from, to);

  // Anomaly detection always uses the trailing 11 COMPLETE months (the
  // timeline's 12th/most-recent point is the current, still-in-progress
  // period) regardless of the requested display period — a deliberate,
  // documented simplification so anomaly baselines stay stable and
  // comparable across every period a user might select for the overview.
  const historyExcludingCurrent = (key: string): number[] => timeline.points.slice(0, -1).map((p: any) => p[key]).filter((v: any): v is number => v != null);

  const revenueScreens = ["/dashboard/financial-statements"];
  const foodCostScreens = ["/dashboard/insights"];
  const labourScreens = ["/dashboard/attendance"];

  const insights: (Insight | null)[] = [
    revenueChangeInsight(byKey.revenue, revenueScreens),
    foodCostTargetInsight(byKey.foodCostPercentage, byKey.revenue, foodCostScreens),
    fallingProfitabilityRisk(byKey.netProfit, revenueScreens),
    risingCostRisk(byKey.foodCostPercentage, "Food Cost %", foodCostScreens),
    risingCostRisk(byKey.labourCostPercentage, "Labour Cost %", labourScreens),
    lowForecastConfidenceRisk(forecast, ["/dashboard/forecasting"]),
    weakBusinessHealthRisk(health, ["/dashboard/executive"]),
    decliningCustomerGrowthRisk(byKey.customerGrowthPercentage, ["/dashboard/customers"]),
    improvingForecastTrendOpportunity(forecast.kpis.find((k: any) => k.key === "revenue"), ["/dashboard/forecasting"]),
    healthyMarginOpportunity(byKey.ebitdaPercentage, ["/dashboard/executive"]),
    detectAnomaly("Revenue", "revenue", "currency", historyExcludingCurrent("revenue"), byKey.revenue.current, true, revenueScreens),
    detectAnomaly("Food Cost %", "foodCostPercentage", "percentage", historyExcludingCurrent("foodCostPercentage"), byKey.foodCostPercentage.current, false, foodCostScreens),
    detectAnomaly("Labour Cost %", "labourCostPercentage", "percentage", historyExcludingCurrent("labourCostPercentage"), byKey.labourCostPercentage.current, false, labourScreens),
    detectAnomaly("Net Profit", "netProfit", "currency", historyExcludingCurrent("netProfit"), byKey.netProfit.current, true, revenueScreens),
    ...persistentBudgetMissRisks(budgetCriticalRows, ["/dashboard/budget"]),
    ...delayedInvestmentPaybackRisks(portfolio.needsAttention, ["/dashboard/investment-analysis"]),
    ...strongROIInvestmentOpportunities(portfolio.topPerforming, ["/dashboard/investment-analysis"]),
    ...delayLowReturnInvestmentRecommendations(portfolio.needsAttention, ["/dashboard/investment-analysis"]),
  ];

  if (multiBranch) {
    const networkAverageHealth = multiBranch.branches.length > 0 ? multiBranch.branches.reduce((s: number, b: any) => s + b.healthScore, 0) / multiBranch.branches.length : null;
    insights.push(
      highGrowthBranchOpportunity(multiBranch.mostImproved, ["/dashboard/comparison"]),
      branchUnderperformingPeersRisk(multiBranch.lowestPerforming, networkAverageHealth, ["/dashboard/comparison"]),
      expandHighPerformingBranchRecommendation(multiBranch.bestPerforming, ["/dashboard/investment-analysis"]),
    );
  }

  const filtered = insights.filter((i): i is Insight => i !== null);
  await logInsightsService(restaurantId, branchId, filtered);
  return filtered;
};

export const getRiskAssessmentService = async (restaurantId: number, branchId: number | null, period: PeriodKey, from?: string, to?: string) =>
  (await generateInsightsService(restaurantId, branchId, period, from, to)).filter((i) => i.category === "risk");

export const getOpportunitiesService = async (restaurantId: number, branchId: number | null, period: PeriodKey, from?: string, to?: string) =>
  (await generateInsightsService(restaurantId, branchId, period, from, to)).filter((i) => i.category === "opportunity");

export const getRecommendationsService = async (restaurantId: number, branchId: number | null, period: PeriodKey, from?: string, to?: string) =>
  (await generateInsightsService(restaurantId, branchId, period, from, to)).filter((i) => i.category === "recommendation");

export const getAnomaliesService = async (restaurantId: number, branchId: number | null, period: PeriodKey, from?: string, to?: string) =>
  (await generateInsightsService(restaurantId, branchId, period, from, to)).filter((i) => i.category === "anomaly");

// ── Historical Insight Timeline (spec section 10) — an audit log, not a financial data store ──

const floorToDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/** Idempotent per (restaurant, branch, category, title, calendar day) — repeatedly viewing the AI Advisor dashboard in the same business day never spams duplicate log rows, mirroring FinancialForecast's own "idempotent snapshot" precedent (Phase 5). */
const logInsightsService = async (restaurantId: number, branchId: number | null, insights: Insight[]): Promise<void> => {
  const logDate = floorToDay(new Date());
  await Promise.all(
    insights.map(async (insight) => {
      const existing = await prisma.aIInsightLog.findFirst({ where: { restaurantId, branchId, category: insight.category, title: insight.title, logDate } });
      if (existing) return;
      await prisma.aIInsightLog.create({
        data: {
          restaurantId, branchId, category: insight.category, severity: insight.severity, title: insight.title,
          summary: insight.summary, confidence: insight.confidence,
          supportingMetrics: insight.supportingMetrics as any, recommendedActions: insight.recommendedActions as any, relatedScreens: insight.relatedScreens as any,
          logDate,
        },
      });
    }),
  );
};

export const getInsightTimelineService = async (restaurantId: number, branchId: number | null | undefined, limit = 50) =>
  prisma.aIInsightLog.findMany({
    where: { restaurantId, ...(branchId !== undefined ? { branchId } : {}) },
    orderBy: { logDate: "desc" },
    take: limit,
  });

// ── Executive AI Brief (spec section 5) ──────────────────────────────────

export const getExecutiveBriefService = async (restaurantId: number, branchId: number | null, period: PeriodKey, from?: string, to?: string): Promise<ExecutiveBrief> => {
  const [insights, health, panels] = await Promise.all([
    generateInsightsService(restaurantId, branchId, period, from, to),
    getBusinessHealthScoreService(restaurantId, branchId, period, from, to),
    getInsightPanelsService(restaurantId, branchId, period, from, to),
  ]);

  const biggestWins = insights.filter((i) => i.category === "opportunity").slice(0, 3);
  const biggestRisks = [...insights.filter((i) => i.category === "risk")].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]).slice(0, 3);
  const immediatePriorities = biggestRisks.filter((r) => r.severity === "critical" || r.severity === "high").map((r) => r.title);

  let branchRankings: { name: string; healthScore: number }[] = [];
  if (branchId === null) {
    const multiBranch = await getMultiBranchExecutiveViewService(restaurantId, period, from, to);
    branchRankings = multiBranch.branches.map((b: any) => ({ name: b.branch.name, healthScore: b.healthScore }));
  }

  return {
    generatedAt: new Date().toISOString(),
    businessHealth: { overall: health.overall, status: health.status },
    biggestWins,
    biggestRisks,
    budgetPerformance: panels.actualVsBudget ? `Tracking against "${panels.actualVsBudget.budgetName}".` : "No published budget for this scope yet.",
    forecastSummary: `Next month's forecast (${panels.forecastSummary.modelUsed}) has ${panels.forecastSummary.confidence} confidence.`,
    investmentUpdates: `${fmtValue(panels.investmentPortfolioSummary.totalCapitalDeployed)} deployed across ${panels.investmentPortfolioSummary.projectCount} project(s), averaging ${panels.investmentPortfolioSummary.averageROI != null ? `${panels.investmentPortfolioSummary.averageROI.toFixed(1)}%` : "—"} ROI.`,
    branchRankings,
    immediatePriorities: immediatePriorities.length > 0 ? immediatePriorities : ["No urgent priorities — business is tracking well."],
  };
};

// ── Branch AI Insights (spec section 6) ──────────────────────────────────

export const getBranchNarrativesService = async (restaurantId: number, period: PeriodKey, from?: string, to?: string): Promise<BranchNarrative[]> => {
  const multiBranch = await getMultiBranchExecutiveViewService(restaurantId, period, from, to);
  const branches = multiBranch.branches;
  if (branches.length === 0) return [];

  const avg = (key: string) => branches.reduce((s: number, b: any) => s + (b[key] ?? 0), 0) / branches.length;
  const networkAvgAOV = avg("avgOrderValue");
  const networkAvgRepeat = avg("repeatCustomerRate");
  const networkAvgHealth = avg("healthScore");
  const networkAvgFoodCost = avg("foodCostPercentage");
  const networkAvgLabour = avg("labourCostPercentage");

  return branches.map((b: any) => {
    const strengths: string[] = [];
    const risks: string[] = [];
    const opportunities: string[] = [];

    if (b.avgOrderValue != null && b.avgOrderValue > networkAvgAOV * 1.1) strengths.push(`the highest Average Order Value (${fmtValue(b.avgOrderValue)} vs a network average of ${fmtValue(Math.round(networkAvgAOV))})`);
    if (b.repeatCustomerRate != null && b.repeatCustomerRate > networkAvgRepeat + 5) strengths.push(`a strong repeat customer rate (${b.repeatCustomerRate.toFixed(0)}% vs a network average of ${networkAvgRepeat.toFixed(0)}%)`);
    if (b.foodCostPercentage != null && b.foodCostPercentage > networkAvgFoodCost + 3) risks.push(`Food Cost % (${b.foodCostPercentage.toFixed(1)}%) running above the network average (${networkAvgFoodCost.toFixed(1)}%)`);
    if (b.labourCostPercentage != null && b.labourCostPercentage > networkAvgLabour + 3) risks.push(`Labour Cost % (${b.labourCostPercentage.toFixed(1)}%) running above the network average (${networkAvgLabour.toFixed(1)}%)`);
    if (b.healthScore >= networkAvgHealth + 10) opportunities.push("a strong candidate for expansion or as a template for other branches");
    if (b.healthScore <= networkAvgHealth - 10) opportunities.push("a focused operational review to close the gap with the network average");

    let narrative: string;
    if (b.healthScore >= networkAvgHealth + 10) {
      narrative = `${b.branch.name} is consistently outperforming the network${strengths.length > 0 ? ` because it has ${strengths.join(" and ")}` : ` with a Business Health Score of ${b.healthScore}/100 versus a network average of ${networkAvgHealth.toFixed(0)}`}.`;
    } else if (b.healthScore <= networkAvgHealth - 10) {
      narrative = `${b.branch.name} is underperforming the network (Health Score ${b.healthScore}/100 vs a network average of ${networkAvgHealth.toFixed(0)})${risks.length > 0 ? `, driven mainly by ${risks.join(" and ")}` : ""}.`;
    } else {
      narrative = `${b.branch.name} is performing in line with the network average (Health Score ${b.healthScore}/100 vs ${networkAvgHealth.toFixed(0)}).`;
    }

    return { branchId: b.branch.id, branchName: b.branch.name, narrative, strengths, risks, opportunities, healthScore: b.healthScore };
  });
};

// ── Conversational Finance API (spec section 9) — structured services a future AI model can call as tools; no NLP/LLM here ──

export const answerWhyProfitChangedService = async (restaurantId: number, branchId: number | null, period: PeriodKey, from?: string, to?: string): Promise<ConversationalAnswer> => {
  const overview = await getExecutiveOverviewService(restaurantId, branchId, period, from, to);
  const byKey = Object.fromEntries(overview.kpis.map((r: any) => [r.key, r]));
  const netProfit = byKey.netProfit;
  const revenue = byKey.revenue;
  const foodCostPct = byKey.foodCostPercentage;
  const labourCostPct = byKey.labourCostPercentage;

  if (netProfit.current == null || netProfit.previousPeriod == null || revenue.previousPeriod == null) {
    return { question: "Why did profit change?", answer: "Not enough historical data yet to explain the change in Net Profit.", supportingMetrics: [], relatedScreens: ["/dashboard/financial-statements"] };
  }

  const revenueDelta = revenue.current - revenue.previousPeriod;
  // Reconstructed from two already-computed real numbers (a percentage and a revenue figure), not a new calculation — the same kind of presentation-layer derivation already used for Investment's Forecast comparison (Phase 6).
  const foodCostCurrent = (foodCostPct.current / 100) * revenue.current;
  const foodCostPrev = foodCostPct.previousPeriod != null ? (foodCostPct.previousPeriod / 100) * revenue.previousPeriod : foodCostCurrent;
  const labourCostCurrent = (labourCostPct.current / 100) * revenue.current;
  const labourCostPrev = labourCostPct.previousPeriod != null ? (labourCostPct.previousPeriod / 100) * revenue.previousPeriod : labourCostCurrent;

  const drivers = [
    { label: "Revenue", impact: revenueDelta },
    { label: "Food Cost", impact: -(foodCostCurrent - foodCostPrev) },
    { label: "Labour Cost", impact: -(labourCostCurrent - labourCostPrev) },
  ].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  const primary = drivers[0];

  const direction = netProfit.current >= netProfit.previousPeriod ? "increased" : "decreased";
  const answer = `Net Profit ${direction} by ${fmtValue(Math.abs(netProfit.current - netProfit.previousPeriod))} (${fmtValue(netProfit.current)} vs ${fmtValue(netProfit.previousPeriod)}). The biggest driver was ${primary.label} (${primary.impact >= 0 ? "+" : ""}${fmtValue(Math.round(primary.impact))} impact on profit).`;

  return {
    question: "Why did profit change?",
    answer,
    supportingMetrics: [
      { key: "netProfit", label: "Net Profit", value: netProfit.current, unit: "currency" },
      { key: "netProfitPrevious", label: "Previous Net Profit", value: netProfit.previousPeriod, unit: "currency" },
      ...drivers.map((d) => ({ key: d.label.toLowerCase().replace(" ", ""), label: `${d.label} Impact`, value: Math.round(d.impact), unit: "currency" as const })),
    ],
    relatedScreens: ["/dashboard/financial-statements", "/dashboard/insights"],
  };
};

export const answerBestPerformingBranchService = async (restaurantId: number, period: PeriodKey, from?: string, to?: string): Promise<ConversationalAnswer> => {
  const view = await getMultiBranchExecutiveViewService(restaurantId, period, from, to);
  if (!view.bestPerforming) return { question: "Which branch performed best?", answer: "No branches to compare yet.", supportingMetrics: [], relatedScreens: ["/dashboard/comparison"] };
  const b = view.bestPerforming;
  return {
    question: "Which branch performed best?",
    answer: `${b.branch.name} performed best this period, with a Business Health Score of ${b.healthScore}/100, ${fmtValue(b.revenue)} in revenue, and ${fmtValue(b.ebitda)} EBITDA.`,
    supportingMetrics: [
      { key: "healthScore", label: "Health Score", value: b.healthScore, unit: "count" },
      { key: "revenue", label: "Revenue", value: b.revenue, unit: "currency" },
      { key: "ebitda", label: "EBITDA", value: b.ebitda, unit: "currency" },
    ],
    relatedScreens: ["/dashboard/comparison", "/dashboard/executive"],
  };
};

export const answerWhyFoodCostChangingService = async (restaurantId: number, branchId: number | null, period: PeriodKey, from?: string, to?: string): Promise<ConversationalAnswer> => {
  const overview = await getExecutiveOverviewService(restaurantId, branchId, period, from, to);
  const byKey = Object.fromEntries(overview.kpis.map((r: any) => [r.key, r]));
  const foodCostPct = byKey.foodCostPercentage;
  if (foodCostPct.current == null) return { question: "Why is Food Cost changing?", answer: "Not enough data available.", supportingMetrics: [], relatedScreens: ["/dashboard/insights"] };
  const trendWord = foodCostPct.trendDirection === "up" ? "increasing" : foodCostPct.trendDirection === "down" ? "decreasing" : "stable";
  const vsTarget = foodCostPct.target != null ? ` versus a target of ${foodCostPct.target.toFixed(1)}%` : "";
  const vsPrevious = foodCostPct.previousPeriod != null ? `, ${foodCostPct.current >= foodCostPct.previousPeriod ? "up" : "down"} from ${foodCostPct.previousPeriod.toFixed(1)}% last period` : "";
  return {
    question: "Why is Food Cost changing?",
    answer: `Food Cost % is ${trendWord} — currently ${foodCostPct.current.toFixed(1)}%${vsTarget}${vsPrevious}.`,
    supportingMetrics: [
      { key: "foodCostPercentage", label: "Food Cost %", value: foodCostPct.current, unit: "percentage" },
      { key: "foodCostTarget", label: "Target", value: foodCostPct.target ?? null, unit: "percentage" },
      { key: "foodCostPercentagePrevious", label: "Previous Period Food Cost %", value: foodCostPct.previousPeriod ?? null, unit: "percentage" },
    ],
    relatedScreens: ["/dashboard/insights", "/dashboard/financial-statements"],
  };
};

export const answerBestROIInvestmentsService = async (restaurantId: number, limit = 5): Promise<ConversationalAnswer> => {
  const withMetrics = await listInvestmentsWithMetricsService(restaurantId, {});
  const ranked = [...withMetrics].sort((a, b) => (b.metrics.roiPercentage ?? -Infinity) - (a.metrics.roiPercentage ?? -Infinity)).slice(0, limit);
  if (ranked.length === 0) return { question: "What investments have the best ROI?", answer: "No investment projects have been created yet.", supportingMetrics: [], relatedScreens: ["/dashboard/investment-analysis"] };
  const top = ranked[0];
  const others = ranked.slice(1, 3).map((r) => `"${r.project.name}" (${r.metrics.roiPercentage?.toFixed(1)}%)`);
  return {
    question: "What investments have the best ROI?",
    answer: `"${top.project.name}" has the best ROI at ${top.metrics.roiPercentage?.toFixed(1)}%${others.length > 0 ? `, followed by ${others.join(", ")}` : ""}.`,
    supportingMetrics: ranked.map((r) => ({ key: `roi-${r.project.id}`, label: r.project.name, value: r.metrics.roiPercentage, unit: "percentage" as const })),
    relatedScreens: ["/dashboard/investment-analysis"],
  };
};

/** Reuses the Scenario Engine's own live (unsaved) What-If override mechanism (Phase 4) directly — the same lever the Scenario UI's sliders use. */
export const answerWhatIfSalesIncreaseService = async (restaurantId: number, branchId: number | null, percentage: number, period: PeriodKey = "currentMonth"): Promise<ConversationalAnswer> => {
  const scenarios = await listScenariosService(restaurantId, { branchId, activeOnly: true });
  const expected = scenarios.find((s: any) => s.type === "EXPECTED") ?? scenarios[0];
  if (!expected) {
    return { question: `What happens if sales increase by ${percentage}%?`, answer: "No scenario is available for this scope yet — visit Scenario Analysis first.", supportingMetrics: [], relatedScreens: ["/dashboard/scenario-analysis"] };
  }
  const whatIf = await runWhatIfService(restaurantId, expected.id, period, undefined, undefined, { revenueGrowthPercentage: percentage });
  const revenue = whatIf.kpis.find((k: any) => k.key === "revenue");
  const ebitda = whatIf.kpis.find((k: any) => k.key === "ebitda");
  return {
    question: `What happens if sales increase by ${percentage}%?`,
    answer: `If revenue grows ${percentage}%, projected Revenue would reach ${fmtValue(revenue?.projected ?? null)} (from ${fmtValue(revenue?.baseline ?? null)}) and EBITDA would move to ${fmtValue(ebitda?.projected ?? null)} (from ${fmtValue(ebitda?.baseline ?? null)}).`,
    supportingMetrics: [
      { key: "projectedRevenue", label: "Projected Revenue", value: revenue?.projected ?? null, unit: "currency" },
      { key: "baselineRevenue", label: "Baseline Revenue", value: revenue?.baseline ?? null, unit: "currency" },
      { key: "projectedEbitda", label: "Projected EBITDA", value: ebitda?.projected ?? null, unit: "currency" },
      { key: "baselineEbitda", label: "Baseline EBITDA", value: ebitda?.baseline ?? null, unit: "currency" },
    ],
    relatedScreens: ["/dashboard/scenario-analysis"],
  };
};

export const answerKpisNeedingAttentionService = async (restaurantId: number, branchId: number | null, period: PeriodKey, from?: string, to?: string): Promise<ConversationalAnswer> => {
  const overview = await getExecutiveOverviewService(restaurantId, branchId, period, from, to);
  const needingAttention = overview.kpis.filter((k: any) => k.status === "critical" || k.status === "warning");
  if (needingAttention.length === 0) {
    return { question: "Which KPIs need immediate attention?", answer: "No KPIs are currently in a critical or warning state.", supportingMetrics: [], relatedScreens: ["/dashboard/executive"] };
  }
  return {
    question: "Which KPIs need immediate attention?",
    answer: `${needingAttention.length} KPI(s) need attention: ${needingAttention.map((k: any) => `${k.label} (${k.status})`).join(", ")}.`,
    supportingMetrics: needingAttention.map((k: any) => ({ key: k.key, label: k.label, value: k.current, unit: k.unit })),
    relatedScreens: ["/dashboard/executive"],
  };
};
