// The single source of truth for every restaurant financial formula.
// Every dashboard, report, export, and API in this app must compute EBITDA/
// Prime Cost/Net Profit/Break-even by calling these functions — never by
// re-deriving them locally. That duplication is exactly how the app ended up
// with two different "Net Profit" definitions (branchComparison.service.ts
// omitted food cost entirely) and an EBITDA figure that disagreed between
// Dashboard and Insights (one prorated fixed costs to the date range, the
// other didn't). Pure functions, no DB access, fully unit-testable.
//
// Definitions used here (standard restaurant finance, matching the SAP
// reference model, not the app's pre-existing ad-hoc definitions):
//   Prime Cost   = Food Cost + Labour Cost
//   Gross Profit = Revenue − Food Cost
//   EBITDA       = Revenue − Food Cost − Labour Cost − Fixed Opex − Variable Opex
//                  (excludes finance cost/interest and GST — GST is a tax
//                  pass-through, not the restaurant's own expense, and
//                  finance cost is excluded from EBITDA by definition)
//   Net Profit   = EBITDA − Finance Cost
//   Contribution Margin = Revenue − Food Cost − Variable Opex (labour and
//                  rent are treated as fixed here, matching the break-even
//                  formula below)

import { FinancialInputs, FinancialMetrics, VarianceMetrics } from "./finance.types";

const pct = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

export const computeFoodCostPercentage = (foodCost: number, revenue: number): number =>
  pct(foodCost, revenue);

export const computeLabourCostPercentage = (labourCost: number, revenue: number): number =>
  pct(labourCost, revenue);

export const computePrimeCost = (foodCost: number, labourCost: number): number =>
  foodCost + labourCost;

export const computePrimeCostPercentage = (primeCost: number, revenue: number): number =>
  pct(primeCost, revenue);

export const computeGrossProfit = (revenue: number, foodCost: number): number =>
  revenue - foodCost;

export const computeGrossProfitMarginPercentage = (grossProfit: number, revenue: number): number =>
  pct(grossProfit, revenue);

export const computeTotalExpenses = (
  inputs: Pick<FinancialInputs, "foodCost" | "labourCost" | "fixedExpenses" | "variableExpenses" | "financeCost" | "gst">,
): number =>
  inputs.foodCost + inputs.labourCost + inputs.fixedExpenses + inputs.variableExpenses + inputs.financeCost + inputs.gst;

export const computeEBITDA = (
  revenue: number,
  foodCost: number,
  labourCost: number,
  fixedExpenses: number,
  variableExpenses: number,
): number => revenue - foodCost - labourCost - fixedExpenses - variableExpenses;

export const computeEBITDAPercentage = (ebitda: number, revenue: number): number =>
  pct(ebitda, revenue);

export const computeNetProfit = (ebitda: number, financeCost: number): number =>
  ebitda - financeCost;

export const computeNetProfitMarginPercentage = (netProfit: number, revenue: number): number =>
  pct(netProfit, revenue);

export const computeContributionMargin = (
  revenue: number,
  foodCost: number,
  variableExpenses: number,
): number => revenue - foodCost - variableExpenses;

export const computeContributionMarginPercentage = (contributionMargin: number, revenue: number): number =>
  pct(contributionMargin, revenue);

/** Revenue needed to cover fixed costs (fixed opex + labour + finance cost), given the contribution margin %. */
export const computeBreakEvenRevenue = (
  fixedExpenses: number,
  labourCost: number,
  financeCost: number,
  contributionMarginPercentage: number,
): number | null => {
  if (contributionMarginPercentage <= 0) return null;
  const breakEvenFixedCosts = fixedExpenses + labourCost + financeCost;
  return Math.round(breakEvenFixedCosts / (contributionMarginPercentage / 100));
};

export const computeBreakEvenOrders = (
  breakEvenRevenue: number | null,
  avgOrderValue: number,
): number | null =>
  breakEvenRevenue !== null && avgOrderValue > 0 ? Math.ceil(breakEvenRevenue / avgOrderValue) : null;

/** Break-even Average Daily Sales — the revenue-per-day needed to break even over the period. */
export const computeBreakEvenADS = (
  breakEvenRevenue: number | null,
  daysInPeriod: number,
): number | null =>
  breakEvenRevenue !== null && daysInPeriod > 0
    ? Math.round((breakEvenRevenue / daysInPeriod) * 100) / 100
    : null;

export const computeMarginOfSafety = (
  actualRevenue: number,
  breakEvenRevenue: number | null,
): number | null => (breakEvenRevenue !== null ? actualRevenue - breakEvenRevenue : null);

export const computeMarginOfSafetyPercentage = (
  marginOfSafety: number | null,
  actualRevenue: number,
): number | null =>
  marginOfSafety !== null && actualRevenue > 0
    ? Math.round((marginOfSafety / actualRevenue) * 1000) / 10
    : null;

/** The one function every consumer should call — computes every derived KPI from raw inputs. */
export const computeFinancialMetrics = (inputs: FinancialInputs): FinancialMetrics => {
  const { revenue, foodCost, labourCost, fixedExpenses, variableExpenses, financeCost, avgOrderValue, orders, daysInPeriod } = inputs;

  const foodCostPercentage = computeFoodCostPercentage(foodCost, revenue);
  const labourCostPercentage = computeLabourCostPercentage(labourCost, revenue);
  const primeCost = computePrimeCost(foodCost, labourCost);
  const primeCostPercentage = computePrimeCostPercentage(primeCost, revenue);
  const grossProfit = computeGrossProfit(revenue, foodCost);
  const grossProfitMarginPercentage = computeGrossProfitMarginPercentage(grossProfit, revenue);
  const totalExpenses = computeTotalExpenses(inputs);
  const ebitda = computeEBITDA(revenue, foodCost, labourCost, fixedExpenses, variableExpenses);
  const ebitdaPercentage = computeEBITDAPercentage(ebitda, revenue);
  const netProfit = computeNetProfit(ebitda, financeCost);
  const netProfitMarginPercentage = computeNetProfitMarginPercentage(netProfit, revenue);
  const contributionMargin = computeContributionMargin(revenue, foodCost, variableExpenses);
  const contributionMarginPercentage = computeContributionMarginPercentage(contributionMargin, revenue);
  const breakEvenRevenue = computeBreakEvenRevenue(fixedExpenses, labourCost, financeCost, contributionMarginPercentage);
  const breakEvenOrders = computeBreakEvenOrders(breakEvenRevenue, avgOrderValue);
  const breakEvenADS = computeBreakEvenADS(breakEvenRevenue, daysInPeriod);
  const marginOfSafety = computeMarginOfSafety(revenue, breakEvenRevenue);
  const marginOfSafetyPercentage = computeMarginOfSafetyPercentage(marginOfSafety, revenue);

  return {
    revenue,
    orders,
    avgOrderValue,
    foodCost,
    foodCostPercentage,
    labourCost,
    labourCostPercentage,
    primeCost,
    primeCostPercentage,
    grossProfit,
    grossProfitMarginPercentage,
    fixedExpenses,
    variableExpenses,
    totalExpenses,
    ebitda,
    ebitdaPercentage,
    financeCost,
    netProfit,
    netProfitMarginPercentage,
    contributionMargin,
    contributionMarginPercentage,
    breakEvenRevenue,
    breakEvenOrders,
    breakEvenADS,
    marginOfSafety,
    marginOfSafetyPercentage,
  };
};

/** Standard hours for a staff member's shift type, from the branch's payroll policy — used to derive an hourly rate from a monthly salary. Single source of truth: previously duplicated between analyticsAdvanced.service.ts's staff-productivity report and (nowhere, before this fix) the Labour Cost figure feeding EBITDA/Net Profit everywhere else, which is why real overtime pay was invisible outside the Attendance page. */
export const computeStandardShiftHours = (
  shift: string | null | undefined,
  payrollPolicy: { morningShiftHours: number; eveningShiftHours: number; fullDayShiftHours: number },
): number => {
  const s = (shift || "").toUpperCase();
  if (s === "MORNING") return payrollPolicy.morningShiftHours || 6;
  if (s === "EVENING") return payrollPolicy.eveningShiftHours || 6;
  return payrollPolicy.fullDayShiftHours || 10;
};

/** Overtime pay for one staff member over some period — hourly rate derived from their monthly salary and standard shift length, times the branch's overtime rate multiplier. */
export const computeOvertimeCost = (
  monthlySalary: number,
  standardShiftHours: number,
  overtimeHours: number,
  overtimeRateMultiplier: number,
): number => {
  const hourlyRate = standardShiftHours > 0 ? monthlySalary / (30 * standardShiftHours) : 0;
  return Math.round(overtimeHours * hourlyRate * overtimeRateMultiplier);
};

/** Variance/trend between a current and previous numeric value — used for every "vs last period" KPI. */
export const computeVariance = (current: number | null, previous: number | null): VarianceMetrics => {
  if (current === null || previous === null) {
    return { value: current, previousValue: previous, variance: null, variancePercentage: null, trendDirection: null };
  }
  const variance = Math.round((current - previous) * 100) / 100;
  const variancePercentage = previous !== 0 ? Math.round((variance / Math.abs(previous)) * 1000) / 10 : null;
  const trendDirection = variance > 0 ? "up" : variance < 0 ? "down" : "flat";
  return { value: current, previousValue: previous, variance, variancePercentage, trendDirection };
};
