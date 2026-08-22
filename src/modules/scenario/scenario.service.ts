// Scenario Analysis — CRUD for FinancialScenario plus the What-If Engine.
// Scenarios never modify orders, inventory, expenses, budgets, or financial
// statements; they are pure planning inputs. The What-If Engine computes a
// projection by reconstructing baseline FinancialInputs from the real
// current-period actuals (via computePeriodMetrics/resolveScopedMetrics,
// unmodified), applying the scenario's overrides to those inputs, and
// calling computeFinancialMetrics (finance.formulas.ts, unmodified) on the
// result — the exact same formula engine every other module uses. The
// projected numbers are computed fresh on every request and never written
// to the database; only the scenario's override DEFINITION is persisted.
import prisma from "../../config/prisma";
import { DateRange, PeriodKey, daysInRange, getComparisonPeriod, resolveDateRange } from "../../utils/dateRange";
import { computeFinancialMetrics, computeVariance } from "../finance/finance.formulas";
import { computeAchievement } from "../finance/finance.ratios";
import {
  fetchInsightsForScope,
  getMenuItemCostMap,
  prorateMonthly,
  resolveScopedMetrics,
  ScopedFinancialBundle,
} from "../finance/finance.service";
import { getResolvedAssumptionsService, getRestaurantDefaultsService } from "../financeAssumptions/financeAssumptions.service";
import { AssumptionValues } from "../financeAssumptions/financeAssumptions.types";
import { FinancialInputs, FinancialMetrics } from "../finance/finance.types";
import {
  BUILT_IN_SCENARIOS,
  ProjectedKpiRow,
  ScenarioOverrideField,
  ScenarioOverrides,
  SCENARIO_OVERRIDE_FIELDS,
  WhatIfResult,
} from "./scenario.types";
import { ValidationError } from "./scenario.validation";

// ── CRUD ──────────────────────────────────────────────────────────────────

const pickOverrides = (row: Record<string, any>): ScenarioOverrides => {
  const overrides: ScenarioOverrides = {};
  for (const field of SCENARIO_OVERRIDE_FIELDS) overrides[field] = row[field] ?? null;
  return overrides;
};

/**
 * Creates the 3 built-in scenarios for a restaurant/branch scope if they
 * don't already exist, AND keeps existing rows' assumption fields in sync
 * with BUILT_IN_SCENARIOS — idempotent, safe to call on every list request.
 * Built-ins are meant to be a fixed reference point every restaurant shares
 * (see updateScenarioService's own lock on editing them); without this sync
 * step, a row created before a config change (or by an older buggy version
 * of this function) would silently drift and keep stale values forever,
 * since nothing else ever writes to a built-in's override fields.
 */
export const ensureBuiltInScenariosService = async (restaurantId: number, branchId: number | null) => {
  const existing = await prisma.financialScenario.findMany({
    where: { restaurantId, branchId, type: { in: ["CONSERVATIVE", "EXPECTED", "OPTIMISTIC"] } },
    select: { id: true, type: true, ...Object.fromEntries(SCENARIO_OVERRIDE_FIELDS.map((f) => [f, true])) },
  });
  const existingByType = new Map(existing.map((e) => [e.type, e]));

  // Every field explicit (config's value, or null for anything the config
  // doesn't set) — not a spread of just b.overrides' keys, so a field that
  // drifted to some other non-null value gets reset to null too, not just
  // fields the config happens to specify.
  const fullOverridesFor = (b: (typeof BUILT_IN_SCENARIOS)[number]) =>
    Object.fromEntries(SCENARIO_OVERRIDE_FIELDS.map((f) => [f, b.overrides[f] ?? null]));

  const toCreate = BUILT_IN_SCENARIOS.filter((b) => !existingByType.has(b.type as any));
  const toSync = BUILT_IN_SCENARIOS.filter((b) => {
    const row = existingByType.get(b.type as any);
    if (!row) return false;
    return SCENARIO_OVERRIDE_FIELDS.some((f) => ((row as any)[f] ?? null) !== (b.overrides[f] ?? null));
  });
  if (toCreate.length === 0 && toSync.length === 0) return;

  await prisma.$transaction([
    ...toCreate.map((b) =>
      prisma.financialScenario.create({
        data: { restaurantId, branchId, name: b.name, description: b.description, type: b.type as any, ...fullOverridesFor(b) },
      }),
    ),
    ...toSync.map((b) =>
      prisma.financialScenario.update({
        where: { id: existingByType.get(b.type as any)!.id },
        data: fullOverridesFor(b),
      }),
    ),
  ]);
};

export const createScenarioService = async (
  restaurantId: number,
  payload: { branchId: number | null; name: string; description: string | null; type: string; overrides: ScenarioOverrides },
  createdById?: number,
) => {
  return prisma.financialScenario.create({
    data: {
      restaurantId,
      branchId: payload.branchId,
      name: payload.name,
      description: payload.description,
      type: payload.type as any,
      createdById,
      updatedById: createdById,
      ...payload.overrides,
    },
  });
};

export const listScenariosService = async (
  restaurantId: number,
  filters: { branchId?: number | null; type?: string; activeOnly?: boolean },
) => {
  // Restaurant-wide built-ins (branchId null) always exist once requested at least once;
  // branch-scoped built-ins are created lazily the first time that branch's scenarios are listed.
  await ensureBuiltInScenariosService(restaurantId, filters.branchId ?? null);

  return prisma.financialScenario.findMany({
    where: {
      restaurantId,
      ...(filters.branchId !== undefined ? { branchId: filters.branchId } : {}),
      ...(filters.type ? { type: filters.type as any } : {}),
      ...(filters.activeOnly ? { isActive: true } : {}),
    },
    include: { branch: { select: { id: true, name: true } } },
    orderBy: [{ type: "asc" }, { createdAt: "desc" }],
  });
};

const findOwnedScenario = async (restaurantId: number, scenarioId: number) => {
  const scenario = await prisma.financialScenario.findUnique({ where: { id: scenarioId } });
  if (!scenario || scenario.restaurantId !== restaurantId) throw new ValidationError("Scenario not found");
  return scenario;
};

export const getScenarioService = async (restaurantId: number, scenarioId: number) => findOwnedScenario(restaurantId, scenarioId);

export const updateScenarioService = async (
  restaurantId: number,
  scenarioId: number,
  payload: { name?: string; description?: string | null; isActive?: boolean; overrides?: ScenarioOverrides },
  updatedById?: number,
) => {
  const scenario = await findOwnedScenario(restaurantId, scenarioId);
  // Conservative/Expected/Optimistic are fixed reference points (-5%/0/+10%
  // revenue & order growth — see BUILT_IN_SCENARIOS) that every restaurant
  // shares; letting them drift from that definition would make them
  // meaningless as a common baseline. isActive (archive/reactivate) is still
  // allowed on any type — only the assumption VALUES are locked. Anyone
  // wanting to tweak assumptions should clone the built-in into a Custom
  // scenario (cloneScenarioService already produces a CUSTOM copy) instead.
  if (scenario.type !== "CUSTOM" && payload.overrides !== undefined) {
    throw new ValidationError("Built-in scenarios' assumptions are fixed and can't be edited — clone it into a Custom scenario to customize.");
  }
  const { overrides, ...rest } = payload;
  return prisma.financialScenario.update({
    where: { id: scenarioId },
    data: { ...rest, ...(overrides ?? {}), updatedById },
  });
};

export const cloneScenarioService = async (
  restaurantId: number,
  scenarioId: number,
  overrides: { name?: string; branchId?: number | null },
  createdById?: number,
) => {
  const source = await findOwnedScenario(restaurantId, scenarioId);
  const overrideValues = pickOverrides(source);
  return prisma.financialScenario.create({
    data: {
      restaurantId,
      branchId: overrides.branchId !== undefined ? overrides.branchId : source.branchId,
      name: overrides.name ?? `${source.name} (Copy)`,
      description: source.description,
      type: "CUSTOM",
      createdById,
      updatedById: createdById,
      ...overrideValues,
    },
  });
};

export const resetScenarioFieldsService = async (
  restaurantId: number,
  scenarioId: number,
  fields: ScenarioOverrideField[],
  updatedById?: number,
) => {
  await findOwnedScenario(restaurantId, scenarioId);
  const data: Record<string, null> = {};
  for (const field of fields) data[field] = null;
  return prisma.financialScenario.update({ where: { id: scenarioId }, data: { ...data, updatedById } });
};

export const deleteScenarioService = async (restaurantId: number, scenarioId: number) => {
  const scenario = await findOwnedScenario(restaurantId, scenarioId);
  if (scenario.type !== "CUSTOM") throw new ValidationError("Built-in scenarios cannot be deleted — archive it instead by setting isActive to false");
  await prisma.financialScenario.delete({ where: { id: scenarioId } });
};

// ── What-If Engine ──────────────────────────────────────────────────────────

/**
 * Applies a scenario's overrides to a baseline scope's metrics + expense
 * components, producing projected FinancialInputs. This function contains
 * every what-if formula in the module — no other place in Scenario touches
 * a growth rate, escalator, or override.
 *
 * Precedence per figure (documented in full in PHASE4_SCENARIO_ANALYSIS_REPORT.md):
 *  - Orders: orderGrowthPercentage off baseline, else baseline unchanged.
 *  - AOV: avgOrderValue absolute override, else baseline unchanged.
 *  - Revenue: revenueGrowthPercentage off baseline wins if set (an explicit
 *    top-line lever); else, if orders or AOV changed, revenue = projected
 *    orders × projected AOV; else baseline unchanged.
 *  - Food cost: a genuinely variable cost — scales with projected revenue at
 *    either the foodCostTargetPercentage override or the baseline ratio.
 *  - Labour: a semi-fixed cost — does NOT auto-scale with revenue. Only
 *    changes via an explicit labourTargetPercentage (of projected revenue)
 *    or a salaryIncrementPercentage escalator off baseline; otherwise flat.
 *  - Rent: absolute override, else rentEscalationPercentage off baseline,
 *    else flat.
 *  - Utilities/Marketing/Maintenance/Packaging: absolute override, else the
 *    general inflationPercentage escalator off baseline, else flat.
 *  - Every other RestaurantInsights-derived expense line (loan EMI, internet,
 *    phone, accounting, insurance, licenses, delivery charges, payment
 *    gateway, aggregator commission, fuel) carries over from baseline,
 *    inflation-escalated if inflationPercentage is set.
 *  - Finance cost (loan EMI/interest, CA fees, insurance, other taxes) is not
 *    addressed by any scenario field and is always carried over unchanged.
 *  - Delivery %/Swiggy/Zomato commission %/Royalty %/Franchise Fee %/Working
 *    Days/Business Hours are stored and inheritable but do not yet feed into
 *    the projected P&L (see the Design Decisions section of the phase
 *    report) — wiring them in would require modelling them as new
 *    FinancialInputs fields, which is out of scope for "reuse, don't modify,
 *    the Finance Engine."
 */
// Exported (only) for direct unit testing — every other call site reaches
// this exclusively through runWhatIfService.
export const applyScenarioOverrides = (
  baseline: FinancialMetrics,
  bundle: ScopedFinancialBundle,
  daysInPeriod: number,
  overrides: ScenarioOverrides,
): { inputs: FinancialInputs; extra: { rent: number; utilities: number } } => {
  const projectedOrders =
    overrides.orderGrowthPercentage != null ? Math.round(baseline.orders * (1 + overrides.orderGrowthPercentage / 100)) : baseline.orders;
  const projectedAOV = overrides.avgOrderValue ?? baseline.avgOrderValue;

  let projectedRevenue: number;
  if (overrides.revenueGrowthPercentage != null) {
    projectedRevenue = baseline.revenue * (1 + overrides.revenueGrowthPercentage / 100);
  } else if (overrides.orderGrowthPercentage != null || overrides.avgOrderValue != null) {
    projectedRevenue = projectedOrders * projectedAOV;
  } else {
    projectedRevenue = baseline.revenue;
  }

  const baselineFoodCostPct = baseline.revenue > 0 ? baseline.foodCost / baseline.revenue : 0;
  const foodCostPct = overrides.foodCostTargetPercentage != null ? overrides.foodCostTargetPercentage / 100 : baselineFoodCostPct;
  const projectedFoodCost = projectedRevenue * foodCostPct;

  let projectedLabour: number;
  if (overrides.labourTargetPercentage != null) {
    projectedLabour = projectedRevenue * (overrides.labourTargetPercentage / 100);
  } else if (overrides.salaryIncrementPercentage != null) {
    projectedLabour = baseline.labourCost * (1 + overrides.salaryIncrementPercentage / 100);
  } else {
    projectedLabour = baseline.labourCost;
  }

  const { components } = bundle;
  const inflate = (v: number) => (overrides.inflationPercentage != null ? v * (1 + overrides.inflationPercentage / 100) : v);

  // rent/utilities/marketing/maintenance/packaging overrides are entered as
  // ₹-per-month figures (mirroring the RestaurantInsights fields they
  // replace), so they're prorated to daysInPeriod exactly like every other
  // monthly figure this engine handles — an unprorated absolute value would
  // silently mismatch the baseline's own proration for any period that isn't
  // exactly 30 days.
  const projectedRent =
    overrides.rent != null
      ? prorateMonthly(overrides.rent, daysInPeriod)
      : overrides.rentEscalationPercentage != null
        ? components.monthlyRent * (1 + overrides.rentEscalationPercentage / 100)
        : components.monthlyRent;
  const baselineUtilities = components.electricity + components.gas;
  const projectedUtilities = overrides.utilities != null ? prorateMonthly(overrides.utilities, daysInPeriod) : inflate(baselineUtilities);
  const projectedMarketing = overrides.marketing != null ? prorateMonthly(overrides.marketing, daysInPeriod) : inflate(components.marketingSpend);
  const projectedMaintenance = overrides.maintenance != null ? prorateMonthly(overrides.maintenance, daysInPeriod) : inflate(components.maintenance);
  const projectedPackaging = overrides.packaging != null ? prorateMonthly(overrides.packaging, daysInPeriod) : inflate(components.packaging);

  const projectedFixedExpenses =
    projectedRent +
    inflate(components.loanEmi) +
    inflate(components.internet) +
    inflate(components.phoneBills) +
    inflate(components.accounting) +
    inflate(components.insurance) +
    inflate(components.licenses);

  const projectedVariableExpenses =
    inflate(components.deliveryCharges) +
    projectedPackaging +
    inflate(components.paymentGateway) +
    inflate(components.aggregatorCommission) +
    projectedUtilities +
    projectedMaintenance +
    inflate(components.fuel) +
    projectedMarketing;

  return {
    inputs: {
      revenue: Math.round(projectedRevenue),
      foodCost: Math.round(projectedFoodCost),
      labourCost: Math.round(projectedLabour),
      fixedExpenses: Math.round(projectedFixedExpenses),
      variableExpenses: Math.round(projectedVariableExpenses),
      financeCost: baseline.financeCost, // no scenario field addresses finance cost — always carried over
      gst: 0,
      orders: projectedOrders,
      avgOrderValue: projectedAOV,
      daysInPeriod,
    },
    extra: { rent: Math.round(projectedRent), utilities: Math.round(projectedUtilities) },
  };
};

type KpiDef = {
  key: string;
  label: string;
  unit: "currency" | "percentage" | "count";
  higherIsBetter: boolean;
  extractor: (m: FinancialMetrics, extra: { rent: number; utilities: number }) => number | null;
  target: (assumptions: AssumptionValues, insights: any) => number | null;
};

const KPI_DEFINITIONS: KpiDef[] = [
  { key: "revenue", label: "Revenue", unit: "currency", higherIsBetter: true, extractor: (m) => m.revenue, target: (_a, i) => i?.monthlyRevenueGoal ?? null },
  { key: "orders", label: "Orders", unit: "count", higherIsBetter: true, extractor: (m) => m.orders, target: () => null },
  { key: "avgOrderValue", label: "Average Order Value", unit: "currency", higherIsBetter: true, extractor: (m) => Math.round(m.avgOrderValue), target: () => null },
  { key: "foodCost", label: "Food Cost", unit: "currency", higherIsBetter: false, extractor: (m) => m.foodCost, target: () => null },
  { key: "foodCostPercentage", label: "Food Cost %", unit: "percentage", higherIsBetter: false, extractor: (m) => m.foodCostPercentage, target: (a) => a.foodCostTargetPercentage },
  { key: "primeCost", label: "Prime Cost", unit: "currency", higherIsBetter: false, extractor: (m) => m.primeCost, target: () => null },
  { key: "primeCostPercentage", label: "Prime Cost %", unit: "percentage", higherIsBetter: false, extractor: (m) => m.primeCostPercentage, target: (a) => a.primeCostTargetPercentage },
  { key: "labour", label: "Labour", unit: "currency", higherIsBetter: false, extractor: (m) => m.labourCost, target: () => null },
  { key: "labourPercentage", label: "Labour %", unit: "percentage", higherIsBetter: false, extractor: (m) => m.labourCostPercentage, target: (a) => a.labourTargetPercentage },
  { key: "rent", label: "Rent", unit: "currency", higherIsBetter: false, extractor: (_m, e) => e.rent, target: () => null },
  { key: "utilities", label: "Utilities", unit: "currency", higherIsBetter: false, extractor: (_m, e) => e.utilities, target: (a) => a.utilityTargetPercentage },
  { key: "operatingExpenses", label: "Operating Expenses", unit: "currency", higherIsBetter: false, extractor: (m) => m.labourCost + m.fixedExpenses + m.variableExpenses, target: () => null },
  { key: "grossProfit", label: "Gross Profit", unit: "currency", higherIsBetter: true, extractor: (m) => m.grossProfit, target: () => null },
  { key: "grossProfitMarginPercentage", label: "Gross Margin %", unit: "percentage", higherIsBetter: true, extractor: (m) => m.grossProfitMarginPercentage, target: (_a, i) => i?.targetGrossMargin ?? null },
  { key: "ebitda", label: "EBITDA", unit: "currency", higherIsBetter: true, extractor: (m) => m.ebitda, target: () => null },
  { key: "ebitdaPercentage", label: "EBITDA %", unit: "percentage", higherIsBetter: true, extractor: (m) => m.ebitdaPercentage, target: (a) => a.ebitdaTargetPercentage },
  { key: "netProfit", label: "Net Profit", unit: "currency", higherIsBetter: true, extractor: (m) => m.netProfit, target: (_a, i) => i?.monthlyProfitGoal ?? null },
  { key: "breakEvenRevenue", label: "Break-even Sales", unit: "currency", higherIsBetter: false, extractor: (m) => m.breakEvenRevenue, target: () => null },
  { key: "breakEvenOrders", label: "Break-even Orders", unit: "count", higherIsBetter: false, extractor: (m) => m.breakEvenOrders, target: () => null },
  { key: "contributionMargin", label: "Contribution Margin", unit: "currency", higherIsBetter: true, extractor: (m) => m.contributionMargin, target: () => null },
  { key: "marginOfSafety", label: "Margin of Safety", unit: "currency", higherIsBetter: true, extractor: (m) => m.marginOfSafety, target: () => null },
  { key: "cashFlow", label: "Cash Flow", unit: "currency", higherIsBetter: true, extractor: () => null, target: () => null },
];

/**
 * Live overrides (not yet saved to the scenario) can be passed via
 * `liveOverrides` for the interactive What-If sliders — merged on top of the
 * saved scenario's overrides for this one calculation only, never persisted.
 */
export const runWhatIfService = async (
  restaurantId: number,
  scenarioId: number,
  period: PeriodKey,
  from?: string,
  to?: string,
  liveOverrides?: ScenarioOverrides,
): Promise<WhatIfResult> => {
  const scenario = await findOwnedScenario(restaurantId, scenarioId);
  const overrides: ScenarioOverrides = { ...pickOverrides(scenario), ...(liveOverrides ?? {}) };

  const range = resolveDateRange(period, from, to);
  const previousRange = getComparisonPeriod(period, range);
  const days = daysInRange(range);

  // Restaurant-wide scenarios (branchId null) have no branch override row to
  // merge against — resolve straight to the restaurant default, matching how
  // resolveScopedMetrics itself treats branchId === null as "every branch".
  const [insightsData, assumptions, menuItemCostMap] = await Promise.all([
    fetchInsightsForScope(restaurantId, scenario.branchId),
    scenario.branchId !== null
      ? getResolvedAssumptionsService(restaurantId, scenario.branchId)
      : getRestaurantDefaultsService(restaurantId),
    getMenuItemCostMap(restaurantId),
  ]);

  const [baselineBundle, previousBundle] = await Promise.all([
    resolveScopedMetrics(restaurantId, scenario.branchId, range, menuItemCostMap, insightsData),
    resolveScopedMetrics(restaurantId, scenario.branchId, previousRange, menuItemCostMap, insightsData),
  ]);

  const { inputs: projectedInputs, extra: projectedExtra } = applyScenarioOverrides(baselineBundle.metrics, baselineBundle, days, overrides);
  const projected = computeFinancialMetrics(projectedInputs);

  const baselineExtra = { rent: baselineBundle.rent, utilities: baselineBundle.utilities };
  const previousExtra = { rent: previousBundle.rent, utilities: previousBundle.utilities };

  const kpis: ProjectedKpiRow[] = KPI_DEFINITIONS.map((def) => {
    const baselineValue = def.extractor(baselineBundle.metrics, baselineExtra);
    const projectedValue = def.extractor(projected, projectedExtra);
    const previousValue = def.extractor(previousBundle.metrics, previousExtra);
    const variance = computeVariance(projectedValue, baselineValue);
    const trend = computeVariance(projectedValue, previousValue);
    const target = def.target(assumptions, insightsDataIsSingleBranch(insightsData) ? insightsData : null);
    const achievementPercentage = computeAchievement(projectedValue, target, def.higherIsBetter);

    return {
      key: def.key,
      label: def.label,
      unit: def.unit,
      higherIsBetter: def.higherIsBetter,
      baseline: baselineValue,
      projected: projectedValue,
      variance: variance.variance,
      variancePercentage: variance.variancePercentage,
      achievementPercentage,
      trendDirection: trend.trendDirection,
    };
  });

  const singleBranchInsights = insightsDataIsSingleBranch(insightsData) ? insightsData : null;

  // The real number in effect for each override field when it's left blank —
  // returned so the frontend can show it instead of a bare "Inherit" label.
  // Mirrors applyScenarioOverrides' own fallback semantics exactly (e.g. the
  // escalator fields fall back to 0%/flat when unset, NOT to Financial
  // Assumptions' own configured rate — see that function's header comment),
  // not a second re-derivation of the same logic. deliveryPercentage/
  // swiggyCommissionPercentage/zomatoCommissionPercentage/royaltyPercentage/
  // franchiseFeePercentage/workingDays/businessHours don't feed the
  // projection at all yet (same doc comment), so their "current value" is
  // just the configured assumption, shown for reference only.
  const currentValues: Record<ScenarioOverrideField, number | null> = {
    revenueGrowthPercentage: 0,
    orderGrowthPercentage: 0,
    avgOrderValue: Math.round(baselineBundle.metrics.avgOrderValue),
    foodCostTargetPercentage: baselineBundle.metrics.revenue > 0 ? Math.round(baselineBundle.metrics.foodCostPercentage * 10) / 10 : null,
    labourTargetPercentage: baselineBundle.metrics.revenue > 0 ? Math.round(baselineBundle.metrics.labourCostPercentage * 10) / 10 : null,
    rent: singleBranchInsights?.monthlyRent ?? null,
    utilities: singleBranchInsights ? (singleBranchInsights.electricity || 0) + (singleBranchInsights.gas || 0) : null,
    marketing: singleBranchInsights?.marketingSpend ?? null,
    maintenance: singleBranchInsights?.maintenance ?? null,
    packaging: singleBranchInsights?.packaging ?? null,
    salaryIncrementPercentage: 0,
    inflationPercentage: 0,
    rentEscalationPercentage: 0,
    deliveryPercentage: assumptions.deliveryPercentage,
    swiggyCommissionPercentage: assumptions.swiggyCommissionPercentage,
    zomatoCommissionPercentage: assumptions.zomatoCommissionPercentage,
    royaltyPercentage: assumptions.royaltyPercentage,
    franchiseFeePercentage: assumptions.franchiseFeePercentage,
    workingDays: assumptions.workingDays,
    businessHours: assumptions.businessHours,
  };

  return {
    scenarioId,
    restaurantId,
    branchId: scenario.branchId,
    period,
    startDate: range.startDate.toISOString(),
    endDate: range.endDate.toISOString(),
    kpis,
    currentValues,
  };
};

const insightsDataIsSingleBranch = (
  insightsData: Awaited<ReturnType<typeof fetchInsightsForScope>>,
): insightsData is Awaited<ReturnType<typeof prisma.restaurantInsights.findUnique>> =>
  insightsData === null || !("branchIds" in (insightsData as object));
