// The Investment Engine's pure capital-budgeting math — no DB access, fully
// unit-testable. This is genuinely new calculation territory (nothing else
// in the app computes ROI/NPV/IRR/Payback), so unlike Scenario/Forecast
// there is no existing formula to reuse here — the "reuse the Finance
// Engine" mandate for this phase is satisfied at the SERVICE layer instead
// (investment.service.ts blends in the Forecast Engine's own projection and
// the Scenario Engine's growth-rate adjustment; see that file's comments).
import { CashFlowProjection, InvestmentAssumptions, InvestmentMetrics } from "./investment.types";

/**
 * Year-by-year incremental operating cash flow this investment is expected
 * to generate. The revenue increase compounds at revenueGrowthPercentage (a
 * genuinely variable, growable figure); cost-side figures (savings,
 * additional opex, maintenance) escalate at inflationRate instead — the same
 * variable-vs-semi-fixed distinction already established for Scenario's
 * What-If Engine (Phase 4). Salvage value is added as a one-time inflow in
 * the project's final year only.
 */
export const computeAnnualCashFlows = (a: InvestmentAssumptions): number[] => {
  const years = Math.max(1, Math.round(a.projectLifeYears));
  return Array.from({ length: years }, (_, t) => {
    const revenueIncrease = (a.monthlyRevenueIncrease || 0) * 12 * Math.pow(1 + (a.revenueGrowthPercentage || 0) / 100, t);
    const costSavings = ((a.expectedCostSavings || 0) + (a.labourSavings || 0)) * 12 * Math.pow(1 + (a.inflationRate || 0) / 100, t);
    const additionalOpex = (a.additionalOperatingExpenses || 0) * 12 * Math.pow(1 + (a.inflationRate || 0) / 100, t);
    const maintenance = (a.maintenanceCost || 0) * Math.pow(1 + (a.inflationRate || 0) / 100, t);
    let cashFlow = revenueIncrease + costSavings - additionalOpex - maintenance;
    if (t === years - 1) cashFlow += a.salvageValue || 0;
    return Math.round(cashFlow);
  });
};

export const computeCumulativeCashFlows = (initialInvestment: number, annualCashFlows: number[]): number[] => {
  const cumulative = [-initialInvestment];
  annualCashFlows.forEach((cf) => cumulative.push(cumulative[cumulative.length - 1] + cf));
  return cumulative;
};

/** Fractional year at which cumulative (undiscounted) cash flow first turns non-negative — null if it never does within the project life. */
export const computePaybackPeriod = (initialInvestment: number, annualCashFlows: number[]): number | null => {
  let cumulative = -initialInvestment;
  for (let year = 0; year < annualCashFlows.length; year++) {
    const prevCumulative = cumulative;
    cumulative += annualCashFlows[year];
    if (cumulative >= 0) {
      if (annualCashFlows[year] === 0) return year + 1;
      const fraction = -prevCumulative / annualCashFlows[year];
      return Math.round((year + fraction) * 100) / 100;
    }
  }
  return null;
};

const npvAtRate = (cashFlowsIncludingYear0: number[], rate: number): number =>
  cashFlowsIncludingYear0.reduce((sum, cf, t) => sum + cf / Math.pow(1 + rate, t), 0);

export const computeDiscountedCashFlows = (initialInvestment: number, annualCashFlows: number[], discountRatePercentage: number): number[] => {
  const rate = discountRatePercentage / 100;
  const withYear0 = [-initialInvestment, ...annualCashFlows];
  return withYear0.map((cf, t) => Math.round(cf / Math.pow(1 + rate, t)));
};

export const computeNPV = (discountedCashFlows: number[]): number => discountedCashFlows.reduce((sum, cf) => sum + cf, 0);

/** Same idea as Payback Period, but on discounted cash flows — a stricter break-even measure that accounts for the time value of money. discountedCashFlows[0] is year 0. */
export const computeDiscountedPaybackPeriod = (discountedCashFlows: number[]): number | null => {
  let cumulative = discountedCashFlows[0];
  for (let year = 1; year < discountedCashFlows.length; year++) {
    const prevCumulative = cumulative;
    cumulative += discountedCashFlows[year];
    if (cumulative >= 0) {
      if (discountedCashFlows[year] === 0) return year;
      const fraction = -prevCumulative / discountedCashFlows[year];
      return Math.round((year - 1 + fraction) * 100) / 100;
    }
  }
  return null;
};

export const computeProfitabilityIndex = (npv: number, initialInvestment: number): number | null =>
  initialInvestment > 0 ? Math.round(((npv + initialInvestment) / initialInvestment) * 1000) / 1000 : null;

export const computeROI = (annualCashFlows: number[], initialInvestment: number): number | null => {
  if (initialInvestment <= 0) return null;
  const totalCashFlow = annualCashFlows.reduce((s, cf) => s + cf, 0);
  return Math.round(((totalCashFlow - initialInvestment) / initialInvestment) * 1000) / 10;
};

export const computeAnnualizedROI = (roiPercentage: number | null, projectLifeYears: number): number | null =>
  roiPercentage !== null && projectLifeYears > 0 ? Math.round((roiPercentage / projectLifeYears) * 10) / 10 : null;

const bisectionIRR = (cashFlowsIncludingYear0: number[]): number | null => {
  const lo0 = -0.99;
  const hi0 = 10;
  let lo = lo0;
  let hi = hi0;
  let npvLo = npvAtRate(cashFlowsIncludingYear0, lo);
  const npvHi = npvAtRate(cashFlowsIncludingYear0, hi);
  if (Math.abs(npvLo) < 0.01) return Math.round(lo * 10000) / 100;
  if (Math.abs(npvHi) < 0.01) return Math.round(hi * 10000) / 100;
  if ((npvLo > 0) === (npvHi > 0)) return null; // no sign change across the whole search domain -> no real root in range
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const npvMid = npvAtRate(cashFlowsIncludingYear0, mid);
    if (Math.abs(npvMid) < 0.01) return Math.round(mid * 10000) / 100;
    if ((npvMid > 0) === (npvLo > 0)) { lo = mid; npvLo = npvMid; } else { hi = mid; }
  }
  return Math.round(((lo + hi) / 2) * 10000) / 100;
};

/** Internal Rate of Return — the discount rate at which NPV = 0. Newton-Raphson with a bisection fallback; returns null if no real root exists (e.g. every cash flow is the same sign, so no break-even rate can exist). */
export const computeIRR = (cashFlowsIncludingYear0: number[]): number | null => {
  const hasNegative = cashFlowsIncludingYear0.some((cf) => cf < 0);
  const hasPositive = cashFlowsIncludingYear0.some((cf) => cf > 0);
  if (!hasNegative || !hasPositive) return null;

  let rate = 0.1;
  for (let i = 0; i < 100; i++) {
    const npv = npvAtRate(cashFlowsIncludingYear0, rate);
    const derivative = cashFlowsIncludingYear0.reduce((sum, cf, t) => (t === 0 ? sum : sum - (t * cf) / Math.pow(1 + rate, t + 1)), 0);
    if (Math.abs(derivative) < 1e-9) break;
    const nextRate = rate - npv / derivative;
    if (Math.abs(nextRate - rate) < 1e-7) return Math.round(nextRate * 10000) / 100;
    rate = nextRate <= -0.99 ? -0.99 : nextRate;
  }
  return bisectionIRR(cashFlowsIncludingYear0);
};

export const projectCashFlows = (a: InvestmentAssumptions): CashFlowProjection => {
  const annualCashFlows = computeAnnualCashFlows(a);
  const cumulativeCashFlows = computeCumulativeCashFlows(a.initialInvestment, annualCashFlows);
  const discountedCashFlows = computeDiscountedCashFlows(a.initialInvestment, annualCashFlows, a.discountRate);
  return { annualCashFlows, cumulativeCashFlows, discountedCashFlows };
};

/** The one function investment.service.ts calls per project — every metric derives from the same single cash-flow projection, so ROI/NPV/IRR/Payback can never disagree with each other about what the cash flows actually are. */
export const computeInvestmentMetrics = (a: InvestmentAssumptions): InvestmentMetrics => {
  const projection = projectCashFlows(a);
  const npv = computeNPV(projection.discountedCashFlows);
  const roiPercentage = computeROI(projection.annualCashFlows, a.initialInvestment);
  return {
    roiPercentage,
    annualizedRoiPercentage: computeAnnualizedROI(roiPercentage, a.projectLifeYears),
    paybackPeriodYears: computePaybackPeriod(a.initialInvestment, projection.annualCashFlows),
    discountedPaybackPeriodYears: computeDiscountedPaybackPeriod(projection.discountedCashFlows),
    npv,
    irrPercentage: computeIRR([-a.initialInvestment, ...projection.annualCashFlows]),
    profitabilityIndex: computeProfitabilityIndex(npv, a.initialInvestment),
    projection,
  };
};
