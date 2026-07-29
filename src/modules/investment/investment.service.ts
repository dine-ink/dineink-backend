// Investment Analysis & Capital Planning — CRUD for InvestmentProject plus
// the Investment Engine (ROI/NPV/IRR/Payback via investment.formulas.ts).
// "Reuse the Finance Engine" for this phase means: reuse the Forecast Engine
// (Phase 5, unmodified) for the "Current Forecast vs Forecast With
// Investment" comparison, and reuse the Scenario Engine (Phase 4, unmodified)
// for "evaluate this investment under Conservative/Expected/Optimistic/
// Custom" — never re-deriving either. The capital-budgeting math itself
// (ROI/NPV/IRR/Payback) has no existing formula anywhere in this app to
// reuse; that genuinely new math lives in investment.formulas.ts.
import prisma from "../../config/prisma";
import { computeVariance } from "../finance/finance.formulas";
import { generateForecastService } from "../forecast/forecast.service";
import { getRestaurantDefaultsService, getResolvedAssumptionsService } from "../financeAssumptions/financeAssumptions.service";
import { runWhatIfService } from "../scenario/scenario.service";
import { computeInvestmentMetrics } from "./investment.formulas";
import { ForecastComparisonRow, InvestmentAssumptions, InvestmentMetrics } from "./investment.types";
import { ValidationError } from "./investment.validation";

// A documented fallback — this app has no existing "hurdle rate"/WACC
// concept anywhere to inherit a default from (confirmed: no discountRate
// field exists on FinancialAssumptions or anywhere else). 12% is a
// commonly-used small-business/restaurant WACC proxy, used only when the
// project doesn't specify its own rate.
const DEFAULT_DISCOUNT_RATE = 12;

// ── CRUD ──────────────────────────────────────────────────────────────────

export const createInvestmentService = async (
  restaurantId: number,
  payload: {
    branchId: number | null; name: string; type: string; description: string | null;
    initialInvestment: number; plannedStartDate: Date; expectedCompletionDate: Date | null; projectLifeYears: number;
    discountRate?: number | null; inflationRate?: number | null; monthlyRevenueIncrease?: number | null;
    revenueGrowthPercentage?: number | null; expectedCostSavings?: number | null; labourSavings?: number | null;
    additionalOperatingExpenses?: number | null; maintenanceCost?: number | null; salvageValue?: number | null;
  },
  createdById?: number,
) => {
  // Defaults sourced from the Financial Assumptions Engine at creation time
  // only (never re-synced afterward, matching Scenario's own "inherit once,
  // then it's yours to edit" philosophy) — inflationRate <- resolved
  // inflationPercentage; discountRate has no equivalent anywhere, so it
  // falls back to DEFAULT_DISCOUNT_RATE instead of silently reading the
  // wrong field.
  let inflationDefault = 0;
  if (payload.inflationRate === undefined || payload.inflationRate === null) {
    const assumptions = payload.branchId !== null
      ? await getResolvedAssumptionsService(restaurantId, payload.branchId)
      : await getRestaurantDefaultsService(restaurantId);
    inflationDefault = assumptions.inflationPercentage ?? 0;
  }

  return prisma.investmentProject.create({
    data: {
      restaurantId,
      branchId: payload.branchId,
      name: payload.name,
      type: payload.type as any,
      description: payload.description,
      initialInvestment: payload.initialInvestment,
      plannedStartDate: payload.plannedStartDate,
      expectedCompletionDate: payload.expectedCompletionDate,
      projectLifeYears: payload.projectLifeYears,
      discountRate: payload.discountRate ?? DEFAULT_DISCOUNT_RATE,
      inflationRate: payload.inflationRate ?? inflationDefault,
      monthlyRevenueIncrease: payload.monthlyRevenueIncrease ?? null,
      revenueGrowthPercentage: payload.revenueGrowthPercentage ?? null,
      expectedCostSavings: payload.expectedCostSavings ?? null,
      labourSavings: payload.labourSavings ?? null,
      additionalOperatingExpenses: payload.additionalOperatingExpenses ?? null,
      maintenanceCost: payload.maintenanceCost ?? null,
      salvageValue: payload.salvageValue ?? null,
      createdById,
    },
  });
};

export const listInvestmentsService = async (restaurantId: number, filters: { branchId?: number | null; status?: string; type?: string }) =>
  prisma.investmentProject.findMany({
    where: {
      restaurantId,
      ...(filters.branchId !== undefined ? { branchId: filters.branchId } : {}),
      ...(filters.status ? { status: filters.status as any } : {}),
      ...(filters.type ? { type: filters.type as any } : {}),
    },
    include: { branch: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

const findOwnedInvestment = async (restaurantId: number, investmentId: number) => {
  const investment = await prisma.investmentProject.findUnique({ where: { id: investmentId } });
  if (!investment || investment.restaurantId !== restaurantId) throw new ValidationError("Investment project not found");
  return investment;
};

export const getInvestmentService = async (restaurantId: number, investmentId: number) => findOwnedInvestment(restaurantId, investmentId);

export const updateInvestmentService = async (restaurantId: number, investmentId: number, payload: Record<string, any>, _updatedById?: number) => {
  await findOwnedInvestment(restaurantId, investmentId);
  return prisma.investmentProject.update({ where: { id: investmentId }, data: payload });
};

export const deleteInvestmentService = async (restaurantId: number, investmentId: number) => {
  await findOwnedInvestment(restaurantId, investmentId);
  await prisma.investmentProject.delete({ where: { id: investmentId } });
};

// ── Investment Engine ───────────────────────────────────────────────────────

const toAssumptions = (project: { initialInvestment: number; projectLifeYears: number } & Record<string, any>): InvestmentAssumptions => ({
  initialInvestment: project.initialInvestment,
  projectLifeYears: project.projectLifeYears,
  discountRate: project.discountRate ?? DEFAULT_DISCOUNT_RATE,
  inflationRate: project.inflationRate ?? 0,
  monthlyRevenueIncrease: project.monthlyRevenueIncrease ?? 0,
  revenueGrowthPercentage: project.revenueGrowthPercentage ?? 0,
  expectedCostSavings: project.expectedCostSavings ?? 0,
  labourSavings: project.labourSavings ?? 0,
  additionalOperatingExpenses: project.additionalOperatingExpenses ?? 0,
  maintenanceCost: project.maintenanceCost ?? 0,
  salvageValue: project.salvageValue ?? 0,
});

/**
 * "Evaluate under scenario X" reuses the Scenario Engine's own What-If
 * calculation: the referenced FinancialScenario's effect on the branch's
 * (or restaurant's) revenue for the current month is read as a proxy annual
 * growth rate and substituted for the project's own revenueGrowthPercentage
 * — e.g. picking the "Conservative" scenario (-5% revenue) makes the
 * investment's revenue increase grow at -5%/year instead of its own stored
 * assumption. This is a deliberate simplification (a monthly what-if
 * variance used as an annual compounding rate), documented in
 * PHASE6_INVESTMENT_ANALYSIS_REPORT.md, not a second scenario-math
 * implementation.
 */
const applyScenarioToAssumptions = async (restaurantId: number, scenarioId: number, assumptions: InvestmentAssumptions): Promise<InvestmentAssumptions> => {
  const whatIf = await runWhatIfService(restaurantId, scenarioId, "currentMonth");
  const revenueRow = whatIf.kpis.find((k) => k.key === "revenue");
  if (revenueRow?.variancePercentage == null) return assumptions;
  return { ...assumptions, revenueGrowthPercentage: revenueRow.variancePercentage };
};

export const computeMetricsForInvestmentService = async (restaurantId: number, investmentId: number, scenarioId?: number): Promise<InvestmentMetrics> => {
  const project = await findOwnedInvestment(restaurantId, investmentId);
  let assumptions = toAssumptions(project);
  if (scenarioId) assumptions = await applyScenarioToAssumptions(restaurantId, scenarioId, assumptions);
  return computeInvestmentMetrics(assumptions);
};

export const listInvestmentsWithMetricsService = async (
  restaurantId: number,
  filters: { branchId?: number | null; status?: string; type?: string },
  scenarioId?: number,
) => {
  const projects = await listInvestmentsService(restaurantId, filters);
  return Promise.all(
    projects.map(async (project) => {
      let assumptions = toAssumptions(project);
      if (scenarioId) assumptions = await applyScenarioToAssumptions(restaurantId, scenarioId, assumptions);
      return { project, metrics: computeInvestmentMetrics(assumptions) };
    }),
  );
};

/**
 * "Current Forecast vs Forecast With Investment" reuses generateForecastService
 * (Phase 5, unmodified, persist=false — viewing an investment's forecast
 * comparison must not silently accumulate forecast snapshots) for the
 * branch/restaurant's own NEXT_YEAR baseline, then adds this investment's
 * own Year-1 incremental effect on top: the revenue increase alone lifts the
 * Revenue row; the FULL net cash flow (which already nets revenue increase
 * against cost savings/additional opex/maintenance) lifts EBITDA and Net
 * Profit — never both, which would double-count the cost side.
 */
export const getForecastComparisonService = async (
  restaurantId: number,
  investmentId: number,
): Promise<{ withoutInvestment: any; rows: ForecastComparisonRow[] }> => {
  const project = await findOwnedInvestment(restaurantId, investmentId);
  const assumptions = toAssumptions(project);
  const metrics = computeInvestmentMetrics(assumptions);
  const year1CashFlow = metrics.projection.annualCashFlows[0] ?? 0;
  const year1RevenueIncrease = Math.round((assumptions.monthlyRevenueIncrease || 0) * 12);

  const withoutInvestment = await generateForecastService(restaurantId, project.branchId, "NEXT_YEAR", "HISTORICAL_TREND", undefined, false);
  const byKey = Object.fromEntries(withoutInvestment.kpis.map((k: any) => [k.key, k]));

  const buildRow = (key: string, label: string, unit: "currency" | "percentage" | "count", uplift: number): ForecastComparisonRow => {
    const baselinePredicted = byKey[key]?.predicted ?? null;
    const withInvestmentValue = baselinePredicted !== null ? baselinePredicted + uplift : null;
    const variance = computeVariance(withInvestmentValue, baselinePredicted);
    return { key, label, unit, withoutInvestment: baselinePredicted, withInvestment: withInvestmentValue, upliftPercentage: variance.variancePercentage };
  };

  const rows: ForecastComparisonRow[] = [
    buildRow("revenue", "Revenue", "currency", year1RevenueIncrease),
    buildRow("ebitda", "EBITDA", "currency", year1CashFlow),
    buildRow("netProfit", "Net Profit", "currency", year1CashFlow),
  ];

  return { withoutInvestment, rows };
};

export const getPortfolioSummaryService = async (restaurantId: number, filters: { branchId?: number | null }) => {
  const withMetrics = await listInvestmentsWithMetricsService(restaurantId, filters);

  const activeOnly = withMetrics.filter((w) => w.project.status !== "CANCELLED");
  const totalCapitalDeployed = activeOnly.reduce((s, w) => s + w.project.initialInvestment, 0);
  const validRois = activeOnly.map((w) => w.metrics.roiPercentage).filter((v): v is number => v !== null);
  const validNpvs = activeOnly.map((w) => w.metrics.npv).filter((v): v is number => v !== null);
  const averageROI = validRois.length > 0 ? Math.round((validRois.reduce((s, v) => s + v, 0) / validRois.length) * 10) / 10 : null;
  const totalNPV = validNpvs.reduce((s, v) => s + v, 0);
  const expectedAnnualReturn = activeOnly.reduce((s, w) => s + (w.metrics.projection.annualCashFlows[0] ?? 0), 0);

  const ranked = [...activeOnly].sort((a, b) => (b.metrics.npv ?? -Infinity) - (a.metrics.npv ?? -Infinity));
  const topPerforming = ranked.filter((w) => (w.metrics.npv ?? 0) > 0 && (w.metrics.roiPercentage ?? 0) > 0).slice(0, 5);
  const needsAttention = ranked.filter((w) => (w.metrics.npv ?? 0) <= 0 || w.metrics.paybackPeriodYears === null).slice(0, 5);

  return {
    restaurantId,
    projectCount: activeOnly.length,
    totalCapitalDeployed,
    averageROI,
    totalNPV: Math.round(totalNPV),
    expectedAnnualReturn: Math.round(expectedAnnualReturn),
    topPerforming,
    needsAttention,
    projects: withMetrics,
  };
};

/** Ranks branches by their investment projects' combined long-term value (total NPV) — spec section 9's "which branch creates the greatest long-term value," plus each branch's best ROI/shortest payback as supporting columns. */
export const rankBranchInvestmentsService = async (restaurantId: number) => {
  const withMetrics = await listInvestmentsWithMetricsService(restaurantId, {});
  type WithMetrics = typeof withMetrics;
  const byBranch = new Map<number | null, { branch: { id: number; name: string } | null; items: WithMetrics }>();

  withMetrics.forEach((w) => {
    const key = w.project.branchId;
    const existing = byBranch.get(key) ?? { branch: (w.project as any).branch ?? null, items: [] as WithMetrics };
    existing.items.push(w);
    byBranch.set(key, existing);
  });

  const ranked = Array.from(byBranch.entries())
    .filter(([branchId]) => branchId !== null)
    .map(([, { branch, items }]) => {
      const npvs = items.map((w) => w.metrics.npv).filter((v): v is number => v !== null);
      const rois = items.map((w) => w.metrics.roiPercentage).filter((v): v is number => v !== null);
      const paybacks = items.map((w) => w.metrics.paybackPeriodYears).filter((v): v is number => v !== null);
      return {
        branch,
        projectCount: items.length,
        totalCapitalDeployed: items.reduce((s, w) => s + w.project.initialInvestment, 0),
        totalNPV: npvs.length > 0 ? Math.round(npvs.reduce((s, v) => s + v, 0)) : null,
        bestROI: rois.length > 0 ? Math.max(...rois) : null,
        shortestPaybackYears: paybacks.length > 0 ? Math.min(...paybacks) : null,
      };
    });

  ranked.sort((a, b) => (b.totalNPV ?? -Infinity) - (a.totalNPV ?? -Infinity));
  return ranked;
};
