import { describe, expect, it } from "vitest";
import { FinancialMetrics } from "../finance/finance.types";
import { ScopedFinancialBundle } from "../finance/finance.service";
import { applyScenarioOverrides } from "./scenario.service";
import { ScenarioOverrides } from "./scenario.types";

// Baseline: revenue 2000, orders 10, AOV 200, foodCost 200 (10%), labour 0,
// fixedExpenses/variableExpenses irrelevant to applyScenarioOverrides itself
// (it rebuilds both from `bundle.components`, not from baseline.fixedExpenses/
// variableExpenses) — financeCost 300 is the one baseline figure always
// carried straight through untouched.
const baseline: FinancialMetrics = {
  revenue: 2000,
  orders: 10,
  avgOrderValue: 200,
  foodCost: 200,
  foodCostPercentage: 10,
  labourCost: 0,
  labourCostPercentage: 0,
  primeCost: 200,
  primeCostPercentage: 10,
  grossProfit: 1800,
  grossProfitMarginPercentage: 90,
  fixedExpenses: 15000,
  variableExpenses: 9200,
  totalExpenses: 24400,
  ebitda: -22400,
  ebitdaPercentage: -1120,
  financeCost: 300,
  netProfit: -22700,
  netProfitMarginPercentage: -1135,
  contributionMargin: 1800,
  contributionMarginPercentage: 90,
  breakEvenRevenue: null,
  breakEvenOrders: null,
  breakEvenADS: null,
  marginOfSafety: null,
  marginOfSafetyPercentage: null,
};

const bundle: ScopedFinancialBundle = {
  metrics: baseline,
  rent: 15000,
  utilities: 4500,
  marketing: 3000,
  maintenance: 1000,
  packaging: 500,
  deliveryCommission: 200,
  components: {
    monthlyRent: 15000,
    loanEmi: 0,
    internet: 0,
    phoneBills: 0,
    accounting: 0,
    insurance: 0,
    licenses: 0,
    deliveryCharges: 0,
    packaging: 500,
    paymentGateway: 0,
    aggregatorCommission: 200,
    electricity: 3000,
    gas: 1500,
    maintenance: 1000,
    fuel: 0,
    marketingSpend: 3000,
    monthlyLoanEmi: 0,
    monthlyInterestPayments: 0,
    caFees: 0,
    insuranceCost: 0,
    otherTaxes: 0,
  },
};

const days = 30; // a clean 30-day month — prorateMonthly(x, 30) === x, isolating each test from proration math

const run = (overrides: ScenarioOverrides) => applyScenarioOverrides(baseline, bundle, days, overrides);

describe("applyScenarioOverrides — orders/AOV/revenue precedence", () => {
  it("leaves everything at baseline when no overrides are set", () => {
    const { inputs } = run({});
    expect(inputs.revenue).toBe(2000);
    expect(inputs.orders).toBe(10);
    expect(inputs.avgOrderValue).toBe(200);
    expect(inputs.foodCost).toBe(200);
    expect(inputs.labourCost).toBe(0);
    expect(inputs.financeCost).toBe(300); // always carried over — no scenario field addresses it
  });

  it("orderGrowthPercentage scales orders and, with no revenueGrowthPercentage, drives revenue via orders x AOV", () => {
    const { inputs } = run({ orderGrowthPercentage: 20 });
    expect(inputs.orders).toBe(12); // round(10 * 1.2)
    expect(inputs.avgOrderValue).toBe(200); // unchanged
    expect(inputs.revenue).toBe(2400); // 12 * 200, NOT baseline * 1.2 (both give 2400 here, but via the order path)
  });

  it("avgOrderValue override alone also drives revenue via orders x AOV", () => {
    const { inputs } = run({ avgOrderValue: 250 });
    expect(inputs.orders).toBe(10); // unchanged
    expect(inputs.avgOrderValue).toBe(250);
    expect(inputs.revenue).toBe(2500); // 10 * 250
  });

  it("revenueGrowthPercentage wins over the order*AOV combo when both are set", () => {
    const { inputs } = run({ revenueGrowthPercentage: 10, orderGrowthPercentage: 50, avgOrderValue: 500 });
    // order*AOV would give round(10*1.5)*500 = 15*500 = 7500 — revenueGrowthPercentage must win instead.
    expect(inputs.revenue).toBe(2200); // 2000 * 1.10
    expect(inputs.orders).toBe(15); // orders/AOV are still independently overridden even though revenue ignores them
    expect(inputs.avgOrderValue).toBe(500);
  });

  it("a negative revenueGrowthPercentage (Conservative-style) reduces revenue", () => {
    const { inputs } = run({ revenueGrowthPercentage: -5 });
    expect(inputs.revenue).toBe(1900);
  });
});

describe("applyScenarioOverrides — food cost (variable) vs labour (semi-fixed)", () => {
  it("food cost scales with projected revenue at the baseline ratio when no target is set", () => {
    const { inputs } = run({ revenueGrowthPercentage: 50 }); // revenue -> 3000
    expect(inputs.foodCost).toBe(300); // 10% of 3000, same ratio as baseline
  });

  it("foodCostTargetPercentage overrides the ratio applied to projected revenue", () => {
    const { inputs } = run({ revenueGrowthPercentage: 10, foodCostTargetPercentage: 15 });
    expect(inputs.foodCost).toBe(330); // 15% of 2200
  });

  it("labour stays flat at baseline when revenue changes and no labour override is set", () => {
    const { inputs } = run({ revenueGrowthPercentage: 50 });
    expect(inputs.labourCost).toBe(0); // baseline labour, unaffected by revenue growth
  });

  it("labourTargetPercentage sets labour as a percentage of PROJECTED revenue", () => {
    const { inputs } = run({ revenueGrowthPercentage: 10, labourTargetPercentage: 20 });
    expect(inputs.labourCost).toBe(440); // 20% of 2200
  });

  it("salaryIncrementPercentage escalates baseline labour directly when no labourTargetPercentage is set", () => {
    const bundleWithLabour: ScopedFinancialBundle = { ...bundle, metrics: { ...baseline, labourCost: 1000 } };
    const { inputs } = applyScenarioOverrides(bundleWithLabour.metrics, bundleWithLabour, days, { salaryIncrementPercentage: 10 });
    expect(inputs.labourCost).toBe(1100); // 1000 * 1.10, independent of revenue
  });

  it("labourTargetPercentage takes precedence over salaryIncrementPercentage when both are set", () => {
    const bundleWithLabour: ScopedFinancialBundle = { ...bundle, metrics: { ...baseline, labourCost: 1000 } };
    const { inputs } = applyScenarioOverrides(bundleWithLabour.metrics, bundleWithLabour, days, {
      labourTargetPercentage: 25, salaryIncrementPercentage: 10,
    });
    expect(inputs.labourCost).toBe(500); // 25% of 2000 (unchanged revenue), NOT the salary-increment path
  });
});

describe("applyScenarioOverrides — rent/utilities/marketing/maintenance/packaging", () => {
  it("an absolute rent override is prorated to daysInPeriod exactly like every other monthly figure", () => {
    const { inputs, extra } = run({ rent: 20000 });
    expect(extra.rent).toBe(20000); // days=30 here, so proration is a no-op (20000*30/30)
    expect(inputs.fixedExpenses).toBe(20000); // only fixed component in this fixture
  });

  it("a 31-day period prorates an absolute rent override above its stated monthly figure", () => {
    const { extra } = applyScenarioOverrides(baseline, bundle, 31, { rent: 20000 });
    expect(extra.rent).toBe(20667); // round(20000 * 31/30)
  });

  it("rentEscalationPercentage escalates baseline rent when no absolute override is set", () => {
    const { extra } = run({ rentEscalationPercentage: 10 });
    expect(extra.rent).toBe(16500); // 15000 * 1.10
  });

  it("an absolute rent override takes precedence over rentEscalationPercentage", () => {
    const { extra } = run({ rent: 20000, rentEscalationPercentage: 50 });
    expect(extra.rent).toBe(20000);
  });

  it("rent stays flat at baseline when neither rent nor rentEscalationPercentage is set", () => {
    const { extra } = run({});
    expect(extra.rent).toBe(15000);
  });

  it("utilities/marketing/maintenance/packaging stay flat with no override and no inflationPercentage", () => {
    const { inputs, extra } = run({});
    expect(extra.utilities).toBe(4500); // 3000 electricity + 1500 gas
    // variableExpenses = deliveryCharges(0) + packaging(500) + paymentGateway(0) + aggregatorCommission(200) + utilities(4500) + maintenance(1000) + fuel(0) + marketing(3000)
    expect(inputs.variableExpenses).toBe(9200);
  });

  it("inflationPercentage escalates utilities/marketing/maintenance/packaging (and every other untouched expense component) when no absolute override is set", () => {
    const { inputs, extra } = run({ inflationPercentage: 10 });
    expect(extra.utilities).toBe(4950); // 4500 * 1.10
    // variableExpenses = 0 + 550(packaging*1.1) + 0 + 220(aggregatorCommission*1.1) + 4950(utilities) + 1100(maintenance*1.1) + 0 + 3300(marketing*1.1)
    expect(inputs.variableExpenses).toBe(10120);
  });

  it("an absolute utilities override takes precedence over inflationPercentage", () => {
    const { extra } = run({ utilities: 6000, inflationPercentage: 50 });
    expect(extra.utilities).toBe(6000);
  });
});

describe("applyScenarioOverrides — finance cost is always carried over unchanged", () => {
  it("no combination of overrides touches financeCost", () => {
    const { inputs } = run({
      revenueGrowthPercentage: 20, foodCostTargetPercentage: 30, labourTargetPercentage: 25,
      rent: 50000, inflationPercentage: 20, salaryIncrementPercentage: 10,
    });
    expect(inputs.financeCost).toBe(300);
  });
});
