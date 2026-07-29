import prisma from "../../config/prisma";
import { resolveDateRange, getComparisonPeriod, daysInRange, PeriodKey, DateRange } from "../../utils/dateRange";
import { recipeCostOf } from "../analytics/analyticsAdvanced.service";
import { getResolvedAssumptionsService } from "../financeAssumptions/financeAssumptions.service";
import { computeFinancialMetrics, computeOvertimeCost, computeStandardShiftHours, computeVariance } from "./finance.formulas";
import { FinancialInputs, FinancialMetrics, FinancialSummary, PeriodMetrics } from "./finance.types";

export type RestaurantInsightsRow = Awaited<ReturnType<typeof prisma.restaurantInsights.findUnique>>;

// Monthly assumption figures (RestaurantInsights) prorated to however many
// days the requested period actually spans — the same principle
// branchComparison.service.ts already applies to labour cost, extended here
// to every other monthly figure so a "Today" or "Last 7 Days" summary isn't
// compared against a full month of fixed costs. Exported for reuse by
// finance.ratios.ts, which needs the same proration for figures (rent,
// utilities) that aren't part of FinancialMetrics itself.
export const prorateMonthly = (monthlyValue: number | null | undefined, days: number): number =>
  Math.round((monthlyValue || 0) * (days / 30));

/**
 * Recipe cost per menu item, restaurant-wide — period-independent (menu
 * items/ingredient prices don't vary by date range), so this is fetched once
 * per request and reused across every period a caller needs, instead of
 * being re-queried for each one. Exported so finance.ratios.ts (which needs
 * the same map across 7 different periods in a single request) can fetch it
 * once and pass it into computePeriodMetrics for all of them.
 */
export const getMenuItemCostMap = async (restaurantId: number): Promise<Map<number, number>> => {
  const menuItems = await prisma.menuItem.findMany({
    where: { restaurantId, isDeleted: false },
    select: {
      id: true,
      menuItemIngredients: {
        select: {
          quantity: true,
          unit: true,
          ingredient: { select: { pricePerUnit: true, unit: true } },
        },
      },
    },
  });
  return new Map(menuItems.map((mi) => [mi.id, recipeCostOf(mi)]));
};

/**
 * Period-accurate food cost. If the owner has set a manual monthly override
 * (RestaurantInsights.manualFoodCost), that's prorated to the period like
 * every other monthly assumption. Otherwise it's computed from real sales:
 * recipe cost per dish × quantity actually sold in the period — accurate for
 * any date range, unlike a point-in-time inventory-value snapshot (which has
 * no "which date range" meaning beyond "right now").
 */
const getFoodCostForPeriod = async (
  restaurantId: number,
  branchId: number,
  range: DateRange,
  manualFoodCostMonthly: number | null | undefined,
  daysInPeriod: number,
  costByMenuItem: Map<number, number>,
): Promise<{ foodCost: number; isManualOverride: boolean }> => {
  if (manualFoodCostMonthly && manualFoodCostMonthly > 0) {
    return { foodCost: prorateMonthly(manualFoodCostMonthly, daysInPeriod), isManualOverride: true };
  }

  const soldQuantities = await prisma.billItem.groupBy({
    by: ["menuItemId"],
    where: {
      menuItemId: { not: null },
      bill: {
        restaurantId,
        branchId,
        status: "PAID",
        createdAt: { gte: range.startDate, lte: range.endDate },
      },
    },
    _sum: { quantity: true },
  });

  let foodCost = 0;
  for (const row of soldQuantities) {
    if (row.menuItemId === null) continue;
    foodCost += (costByMenuItem.get(row.menuItemId) || 0) * (row._sum.quantity || 0);
  }

  return { foodCost: Math.round(foodCost), isManualOverride: false };
};

/**
 * Prorates every RestaurantInsights expense field to the requested period
 * and sums them into fixedExpenses/variableExpenses/financeCost — the exact
 * breakdown computePeriodMetrics needs internally, but exported (with the
 * individual components, not just the totals) so a caller that needs to
 * substitute one component (e.g. the Scenario What-If Engine overriding
 * just rent, or just marketing) can do so without re-deriving this same
 * field list a second time.
 */
export const getExpenseBreakdown = (insights: RestaurantInsightsRow, days: number) => {
  // Totals: prorate the SUM of raw fields once, exactly as the original
  // inline computation did — preserves byte-for-byte identical output for
  // every existing consumer (Ratio Engine, Statements, Budget). Rounding
  // happens once per total, not once per field.
  const fixedExpenses = prorateMonthly(
    (insights?.monthlyRent || 0) +
      (insights?.loanEmi || 0) +
      (insights?.internet || 0) +
      (insights?.phoneBills || 0) +
      (insights?.accounting || 0) +
      (insights?.insurance || 0) +
      (insights?.licenses || 0),
    days,
  );
  const variableExpenses = prorateMonthly(
    (insights?.deliveryCharges || 0) +
      (insights?.packaging || 0) +
      (insights?.paymentGateway || 0) +
      (insights?.aggregatorCommission || 0) +
      (insights?.electricity || 0) +
      (insights?.gas || 0) +
      (insights?.maintenance || 0) +
      (insights?.fuel || 0) +
      (insights?.marketingSpend || 0),
    days,
  );
  const financeCost = prorateMonthly(
    (insights?.monthlyLoanEmi || 0) +
      (insights?.monthlyInterestPayments || 0) +
      (insights?.caFees || 0) +
      (insights?.insuranceCost || 0) +
      (insights?.otherTaxes || 0),
    days,
  );

  // Components: each field individually prorated — for a caller (the
  // Scenario What-If Engine) that needs to substitute ONE component and
  // re-sum, not reproduce the totals above bit-for-bit. A few paisa of
  // rounding drift across untouched components is immaterial for a
  // projection tool; it is never used for the totals returned above.
  const components = {
    monthlyRent: prorateMonthly(insights?.monthlyRent, days),
    loanEmi: prorateMonthly(insights?.loanEmi, days),
    internet: prorateMonthly(insights?.internet, days),
    phoneBills: prorateMonthly(insights?.phoneBills, days),
    accounting: prorateMonthly(insights?.accounting, days),
    insurance: prorateMonthly(insights?.insurance, days),
    licenses: prorateMonthly(insights?.licenses, days),
    deliveryCharges: prorateMonthly(insights?.deliveryCharges, days),
    packaging: prorateMonthly(insights?.packaging, days),
    paymentGateway: prorateMonthly(insights?.paymentGateway, days),
    aggregatorCommission: prorateMonthly(insights?.aggregatorCommission, days),
    electricity: prorateMonthly(insights?.electricity, days),
    gas: prorateMonthly(insights?.gas, days),
    maintenance: prorateMonthly(insights?.maintenance, days),
    fuel: prorateMonthly(insights?.fuel, days),
    marketingSpend: prorateMonthly(insights?.marketingSpend, days),
    monthlyLoanEmi: prorateMonthly(insights?.monthlyLoanEmi, days),
    monthlyInterestPayments: prorateMonthly(insights?.monthlyInterestPayments, days),
    caFees: prorateMonthly(insights?.caFees, days),
    insuranceCost: prorateMonthly(insights?.insuranceCost, days),
    otherTaxes: prorateMonthly(insights?.otherTaxes, days),
  };

  return { components, fixedExpenses, variableExpenses, financeCost };
};

export interface BranchPayrollPolicy {
  morningShiftHours: number;
  eveningShiftHours: number;
  fullDayShiftHours: number;
  overtimeRateMultiplier: number;
}

/**
 * Payroll policy (shift hours + overtime multiplier) for every branch in a
 * restaurant — static per branch, doesn't vary by date range, so (like
 * getMenuItemCostMap) this is fetched once per request and reused across
 * every period/branch a caller needs, instead of being re-queried once per
 * period inside a loop (which is what originally caused a connection-pool
 * exhaustion in Forecast's 12-period fan-out when overtime support was added).
 */
export const getPayrollPolicyMap = async (restaurantId: number): Promise<Map<number, BranchPayrollPolicy>> => {
  const branches = await prisma.branch.findMany({
    where: { restaurantId },
    select: { id: true, morningShiftHours: true, eveningShiftHours: true, fullDayShiftHours: true, overtimeRateMultiplier: true },
  });
  return new Map(branches.map((b) => [b.id, {
    morningShiftHours: b.morningShiftHours ?? 6,
    eveningShiftHours: b.eveningShiftHours ?? 6,
    fullDayShiftHours: b.fullDayShiftHours ?? 10,
    overtimeRateMultiplier: b.overtimeRateMultiplier ?? 1.5,
  }]));
};

export const computePeriodMetrics = async (
  restaurantId: number,
  branchId: number,
  range: DateRange,
  insights: RestaurantInsightsRow,
  /** Pass a pre-fetched map (getMenuItemCostMap) when computing multiple
   * periods in one request to avoid re-querying menu items/ingredients for
   * each one; fetched internally otherwise so single-period callers don't
   * need to know about this. */
  menuItemCostMap?: Map<number, number>,
  /** Same idea as menuItemCostMap, for payroll policy (see getPayrollPolicyMap). */
  payrollPolicyMap?: Map<number, BranchPayrollPolicy>,
): Promise<FinancialMetrics> => {
  const days = daysInRange(range);
  const costByMenuItem = menuItemCostMap ?? (await getMenuItemCostMap(restaurantId));
  const branchPayrollPolicy = payrollPolicyMap
    ? payrollPolicyMap.get(branchId) ?? null
    : await prisma.branch.findUnique({
        where: { id: branchId },
        select: { morningShiftHours: true, eveningShiftHours: true, fullDayShiftHours: true, overtimeRateMultiplier: true },
      }).then((b) => b && ({
        morningShiftHours: b.morningShiftHours ?? 6,
        eveningShiftHours: b.eveningShiftHours ?? 6,
        fullDayShiftHours: b.fullDayShiftHours ?? 10,
        overtimeRateMultiplier: b.overtimeRateMultiplier ?? 1.5,
      }));

  const [billAgg, staff, overtimeAgg, foodCostResult] = await Promise.all([
    prisma.bill.aggregate({
      where: { restaurantId, branchId, status: "PAID", createdAt: { gte: range.startDate, lte: range.endDate } },
      _sum: { total: true, cgst: true, sgst: true },
      _count: { id: true },
    }),
    prisma.user.findMany({
      where: { restaurantId, branchId, isDeleted: false },
      select: { id: true, salary: true, shift: true },
    }),
    prisma.attendance.groupBy({
      by: ["userId"],
      where: { restaurantId, branchId, date: { gte: range.startDate, lte: range.endDate } },
      _sum: { overtimeHours: true },
    }),
    getFoodCostForPeriod(restaurantId, branchId, range, insights?.manualFoodCost, days, costByMenuItem),
  ]);

  const revenue = billAgg._sum.total || 0;
  const orders = billAgg._count.id || 0;
  const avgOrderValue = orders > 0 ? revenue / orders : 0;
  const gst = (billAgg._sum.cgst || 0) + (billAgg._sum.sgst || 0);

  const monthlySalarySum = staff.reduce((s, u) => s + (u.salary || 0), 0);
  // Real overtime pay, actually clocked within this exact period (never
  // prorated, unlike the flat monthly-salary component above — it's already
  // period-accurate by construction). Previously omitted entirely: EBITDA/
  // Net Profit only ever reflected flat salary, even though real overtime
  // cost was already tracked and shown to owners on the Attendance page.
  const payrollPolicy = {
    morningShiftHours: branchPayrollPolicy?.morningShiftHours ?? 6,
    eveningShiftHours: branchPayrollPolicy?.eveningShiftHours ?? 6,
    fullDayShiftHours: branchPayrollPolicy?.fullDayShiftHours ?? 10,
  };
  const overtimeRateMultiplier = branchPayrollPolicy?.overtimeRateMultiplier ?? 1.5;
  const overtimeHoursByUser = new Map(overtimeAgg.map((o) => [o.userId, o._sum.overtimeHours || 0]));
  const overtimeCost = staff.reduce((sum, u) => {
    const overtimeHours = overtimeHoursByUser.get(u.id) || 0;
    if (overtimeHours === 0) return sum;
    const standardShiftHours = computeStandardShiftHours(u.shift, payrollPolicy);
    return sum + computeOvertimeCost(u.salary || 0, standardShiftHours, overtimeHours, overtimeRateMultiplier);
  }, 0);

  const labourCost = prorateMonthly(monthlySalarySum, days) + overtimeCost;
  const { fixedExpenses, variableExpenses, financeCost } = getExpenseBreakdown(insights, days);

  return computeFinancialMetrics({
    revenue,
    foodCost: foodCostResult.foodCost,
    labourCost,
    fixedExpenses,
    variableExpenses,
    financeCost,
    gst,
    avgOrderValue,
    orders,
    daysInPeriod: days,
  });
};

/**
 * The canonical financial summary for a branch + period — current period,
 * comparison ("previous") period, variance between them, and the owner's
 * configured targets. Every screen/export that shows EBITDA, Prime Cost, Net
 * Profit, Break-even, etc. should call this endpoint instead of recomputing
 * them independently.
 */
export const getFinancialSummaryService = async (
  restaurantId: number,
  branchId: number,
  period: PeriodKey,
  from?: string,
  to?: string,
): Promise<FinancialSummary> => {
  const currentRange = resolveDateRange(period, from, to);
  const previousRange = getComparisonPeriod(period, currentRange);

  const [insights, assumptions, menuItemCostMap] = await Promise.all([
    prisma.restaurantInsights.findUnique({ where: { restaurantId_branchId: { restaurantId, branchId } } }),
    getResolvedAssumptionsService(restaurantId, branchId),
    getMenuItemCostMap(restaurantId),
  ]);

  const [currentMetrics, previousMetrics] = await Promise.all([
    computePeriodMetrics(restaurantId, branchId, currentRange, insights, menuItemCostMap),
    computePeriodMetrics(restaurantId, branchId, previousRange, insights, menuItemCostMap),
  ]);

  const current: PeriodMetrics = {
    ...currentMetrics,
    period,
    startDate: currentRange.startDate.toISOString(),
    endDate: currentRange.endDate.toISOString(),
  };
  const previous: PeriodMetrics = {
    ...previousMetrics,
    period,
    startDate: previousRange.startDate.toISOString(),
    endDate: previousRange.endDate.toISOString(),
  };

  return {
    current,
    previous,
    variance: {
      revenue: computeVariance(current.revenue, previous.revenue),
      foodCostPercentage: computeVariance(current.foodCostPercentage, previous.foodCostPercentage),
      primeCostPercentage: computeVariance(current.primeCostPercentage, previous.primeCostPercentage),
      ebitda: computeVariance(current.ebitda, previous.ebitda),
      ebitdaPercentage: computeVariance(current.ebitdaPercentage, previous.ebitdaPercentage),
      netProfit: computeVariance(current.netProfit, previous.netProfit),
      grossProfitMarginPercentage: computeVariance(current.grossProfitMarginPercentage, previous.grossProfitMarginPercentage),
      labourCostPercentage: computeVariance(current.labourCostPercentage, previous.labourCostPercentage),
    },
    targets: {
      targetEbitda: assumptions.ebitdaTargetPercentage,
      targetFoodCost: assumptions.foodCostTargetPercentage,
      targetPrimeCost: assumptions.primeCostTargetPercentage,
      targetLabourCost: assumptions.labourTargetPercentage,
      targetOccupancy: assumptions.occupancyTargetPercentage,
      targetUtility: assumptions.utilityTargetPercentage,
      targetGrossMargin: insights?.targetGrossMargin ?? null,
      monthlyRevenueGoal: insights?.monthlyRevenueGoal ?? null,
      monthlyProfitGoal: insights?.monthlyProfitGoal ?? null,
    },
    isFoodCostManualOverride: !!(insights?.manualFoodCost && insights.manualFoodCost > 0),
  };
};

/**
 * Metrics for one "scope" — a single branch, or (branchId = null) every
 * branch in the restaurant aggregated — plus a few RestaurantInsights-derived
 * figures (rent, utilities, marketing, maintenance, packaging, delivery
 * commission) that aren't part of FinancialMetrics itself. Originally built
 * for the Budget module's variance engine; exported here once both Budget
 * and Scenario need the identical "resolve a branch-or-restaurant scope"
 * pattern, so there is exactly one multi-branch aggregation implementation,
 * not two.
 */
type ExpenseComponents = ReturnType<typeof getExpenseBreakdown>["components"];

export interface ScopedFinancialBundle {
  metrics: FinancialMetrics;
  rent: number;
  utilities: number;
  marketing: number;
  maintenance: number;
  packaging: number;
  deliveryCommission: number;
  /** The full per-field expense breakdown (same shape as getExpenseBreakdown's `components`), already summed across branches for a restaurant-wide scope — for a caller (the Scenario What-If Engine) that needs to substitute one field and rebuild fixed/variableExpenses, not just read the 6 headline figures above. */
  components: ExpenseComponents;
}

const scopedExtrasFromBreakdown = (insights: RestaurantInsightsRow, days: number) => {
  const { components } = getExpenseBreakdown(insights, days);
  return {
    components,
    rent: components.monthlyRent,
    utilities: components.electricity + components.gas,
    marketing: components.marketingSpend,
    maintenance: components.maintenance,
    packaging: components.packaging,
    deliveryCommission: components.aggregatorCommission,
  };
};

/**
 * `insightsData` is pre-fetched by the caller and reused across sibling
 * calls (e.g. current- and previous-period) that always come in pairs —
 * RestaurantInsights doesn't vary by date range, so fetching it once per
 * request (instead of once per call) avoids a real duplicate query.
 */
export const resolveScopedMetrics = async (
  restaurantId: number,
  branchId: number | null,
  range: DateRange,
  menuItemCostMap: Map<number, number>,
  insightsData: RestaurantInsightsRow | { branchIds: number[]; byBranchId: Map<number, RestaurantInsightsRow> },
  /** Same idea as menuItemCostMap — pass a pre-fetched map (getPayrollPolicyMap) when computing multiple periods/branches in one request. */
  payrollPolicyMap?: Map<number, BranchPayrollPolicy>,
): Promise<ScopedFinancialBundle> => {
  const days = daysInRange(range);

  if (branchId !== null) {
    const insights = insightsData as RestaurantInsightsRow;
    const metrics = await computePeriodMetrics(restaurantId, branchId, range, insights, menuItemCostMap, payrollPolicyMap);
    return { metrics, ...scopedExtrasFromBreakdown(insights, days) };
  }

  const { branchIds, byBranchId } = insightsData as { branchIds: number[]; byBranchId: Map<number, RestaurantInsightsRow> };
  const perBranch = await Promise.all(
    branchIds.map(async (id) => {
      const insights = byBranchId.get(id) ?? null;
      const metrics = await computePeriodMetrics(restaurantId, id, range, insights, menuItemCostMap, payrollPolicyMap);
      return { metrics, insights };
    }),
  );

  const sum = (fn: (m: FinancialMetrics) => number) => perBranch.reduce((s, p) => s + fn(p.metrics), 0);
  const revenue = sum((m) => m.revenue);
  const orders = sum((m) => m.orders);
  const aggregatedInputs: FinancialInputs = {
    revenue,
    foodCost: sum((m) => m.foodCost),
    labourCost: sum((m) => m.labourCost),
    fixedExpenses: sum((m) => m.fixedExpenses),
    variableExpenses: sum((m) => m.variableExpenses),
    financeCost: sum((m) => m.financeCost),
    gst: 0,
    orders,
    avgOrderValue: orders > 0 ? revenue / orders : 0,
    daysInPeriod: days,
  };
  const metrics = computeFinancialMetrics(aggregatedInputs);

  const extrasList = perBranch.map((p) => scopedExtrasFromBreakdown(p.insights, days));
  const sumExtra = (key: keyof Omit<ReturnType<typeof scopedExtrasFromBreakdown>, "components">) =>
    extrasList.reduce((s, e) => s + e[key], 0);
  const componentKeys = Object.keys(extrasList[0]?.components ?? {}) as (keyof ExpenseComponents)[];
  const summedComponents = Object.fromEntries(
    componentKeys.map((key) => [key, extrasList.reduce((s, e) => s + e.components[key], 0)]),
  ) as ExpenseComponents;

  return {
    metrics,
    rent: sumExtra("rent"),
    utilities: sumExtra("utilities"),
    marketing: sumExtra("marketing"),
    maintenance: sumExtra("maintenance"),
    packaging: sumExtra("packaging"),
    deliveryCommission: sumExtra("deliveryCommission"),
    components: summedComponents,
  };
};

/** Fetches RestaurantInsights for a budget/scenario's scope in one shot — a single branch's row, or every branch's row (keyed) for a restaurant-wide scope. Shared by anything needing resolveScopedMetrics's insightsData param. */
export const fetchInsightsForScope = async (restaurantId: number, branchId: number | null) => {
  if (branchId !== null) {
    return prisma.restaurantInsights.findUnique({ where: { restaurantId_branchId: { restaurantId, branchId } } });
  }
  const branches = await prisma.branch.findMany({ where: { restaurantId, isDeleted: false }, select: { id: true } });
  const branchIds = branches.map((b) => b.id);
  const insightsRows = await prisma.restaurantInsights.findMany({ where: { restaurantId, branchId: { in: branchIds } } });
  const byBranchId = new Map(insightsRows.map((row) => [row.branchId, row]));
  return { branchIds, byBranchId };
};
