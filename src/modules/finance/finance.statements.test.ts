import { describe, expect, it } from "vitest";
import { computeFinancialMetrics } from "./finance.formulas";
import { buildPnlSections } from "./finance.statements.service";

describe("buildPnlSections — P&L generation (pure, no database)", () => {
  // Same hand-computed scenario used in finance.formulas.test.ts and
  // verified live during Tier-1 correctness testing: ₹2000 revenue, ₹200
  // food cost, ₹1000 labour, ₹500 fixed expenses.
  const metrics = computeFinancialMetrics({
    revenue: 2000,
    foodCost: 200,
    labourCost: 1000,
    fixedExpenses: 500,
    variableExpenses: 0,
    financeCost: 0,
    gst: 0,
    avgOrderValue: 200,
    orders: 10,
    daysInPeriod: 1,
  });
  const sections = buildPnlSections(metrics);

  const findRow = (sectionTitle: string, rowLabel: string) =>
    sections.find((s) => s.title === sectionTitle)?.rows.find((r) => r.label === rowLabel);

  it("produces exactly the 6 standard P&L sections in order", () => {
    expect(sections.map((s) => s.title)).toEqual([
      "Revenue",
      "Cost of Goods Sold",
      "Operating Expenses",
      "EBITDA",
      "Finance Cost",
      "Net Result",
    ]);
  });

  it("Revenue section shows Net Revenue as a total row", () => {
    const r = findRow("Revenue", "Net Revenue");
    expect(r?.value).toBe(2000);
    expect(r?.isTotal).toBe(true);
    expect(r?.unit).toBe("currency");
  });

  it("Cost of Goods Sold section shows Food Cost and Gross Profit", () => {
    expect(findRow("Cost of Goods Sold", "Food Cost")?.value).toBe(200);
    expect(findRow("Cost of Goods Sold", "Gross Profit")?.value).toBe(1800);
    expect(findRow("Cost of Goods Sold", "Gross Margin %")?.value).toBe(90);
  });

  it("Operating Expenses section totals labour + fixed + variable", () => {
    expect(findRow("Operating Expenses", "Labour Cost")?.value).toBe(1000);
    expect(findRow("Operating Expenses", "Fixed Expenses")?.value).toBe(500);
    expect(findRow("Operating Expenses", "Total Operating Expenses")?.value).toBe(1500);
  });

  it("EBITDA section matches the shared finance engine's EBITDA (excludes finance cost)", () => {
    expect(findRow("EBITDA", "EBITDA")?.value).toBe(300);
    expect(findRow("EBITDA", "EBITDA %")?.value).toBe(15);
  });

  it("Net Result equals EBITDA when finance cost is 0", () => {
    expect(findRow("Net Result", "Net Profit")?.value).toBe(300);
  });

  it("changing finance cost only affects Net Result, never EBITDA (EBITDA excludes it by definition)", () => {
    const withFinanceCost = computeFinancialMetrics({
      revenue: 2000,
      foodCost: 200,
      labourCost: 1000,
      fixedExpenses: 500,
      variableExpenses: 0,
      financeCost: 100,
      gst: 0,
      avgOrderValue: 200,
      orders: 10,
      daysInPeriod: 1,
    });
    const withFinanceCostSections = buildPnlSections(withFinanceCost);
    const ebitdaRow = withFinanceCostSections.find((s) => s.title === "EBITDA")?.rows.find((r) => r.label === "EBITDA");
    const netProfitRow = withFinanceCostSections.find((s) => s.title === "Net Result")?.rows.find((r) => r.label === "Net Profit");

    expect(ebitdaRow?.value).toBe(300); // unchanged from the no-finance-cost scenario
    expect(netProfitRow?.value).toBe(200); // 300 - 100
  });
});
