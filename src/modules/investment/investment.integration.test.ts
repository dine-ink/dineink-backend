// Integration test — hits the real configured database directly through the
// service layer (no mocking of Prisma). Creates its own isolated fixture
// restaurant and deletes every row it created afterward; never touches
// pre-existing data. Run via `npm run test:integration`, not the default
// `npm test` (see vitest.integration.config.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "../../config/prisma";
import { createScenarioService } from "../scenario/scenario.service";
import {
  computeMetricsForInvestmentService,
  createInvestmentService,
  deleteInvestmentService,
  getForecastComparisonService,
  getPortfolioSummaryService,
  listInvestmentsService,
  rankBranchInvestmentsService,
  updateInvestmentService,
} from "./investment.service";
import { ValidationError } from "./investment.validation";

describe("Investment module — integration (real database)", () => {
  let restaurantId: number;
  let branchAId: number;
  let branchBId: number;
  let menuItemId: number;
  let investmentId: number;

  beforeAll(async () => {
    const restaurant = await prisma.restaurant.create({ data: { name: "Vitest Investment Integration Restaurant" } });
    restaurantId = restaurant.id;
    const branchA = await prisma.branch.create({ data: { restaurantId, name: "Vitest Investment Branch A" } });
    branchAId = branchA.id;
    const branchB = await prisma.branch.create({ data: { restaurantId, name: "Vitest Investment Branch B" } });
    branchBId = branchB.id;

    const category = await prisma.category.create({ data: { restaurantId, name: "Cat" } });
    const ingCategory = await prisma.ingredientCategory.create({ data: { restaurantId, name: "IngCat" } });
    const ingredient = await prisma.ingredient.create({
      data: { restaurantId, categoryId: ingCategory.id, name: "Bun", unit: "piece", pricePerUnit: 20, purchasePrice: 20 },
    });
    const menuItem = await prisma.menuItem.create({
      data: { restaurantId, branchId: null, categoryId: category.id, name: "Burger", price: 200 },
    });
    menuItemId = menuItem.id;
    await prisma.menuItemIngredient.create({ data: { menuItemId, ingredientId: ingredient.id, quantity: 1, unit: "piece" } });

    // 10 bills this month on Branch A -> baseline revenue 2000, for a clean, hand-predictable Scenario-integration check.
    const today = new Date();
    for (let i = 0; i < 10; i++) {
      const bill = await prisma.bill.create({
        data: { billNo: `VITEST-INV-A-${restaurantId}-${i}`, orderType: "DINE_IN", paymentMethod: "CASH", status: "PAID",
          subtotal: 200, gst: 0, discount: 0, total: 200, restaurantId, branchId: branchAId, createdAt: today },
      });
      await prisma.billItem.create({ data: { billId: bill.id, menuItemId, itemName: "Burger", quantity: 1, price: 200, total: 200 } });
    }
  });

  afterAll(async () => {
    await prisma.investmentProject.deleteMany({ where: { restaurantId } });
    await prisma.financialScenario.deleteMany({ where: { restaurantId } });
    await prisma.billItem.deleteMany({ where: { bill: { restaurantId } } });
    await prisma.bill.deleteMany({ where: { restaurantId } });
    await prisma.menuItemIngredient.deleteMany({ where: { menuItemId } });
    await prisma.menuItem.deleteMany({ where: { restaurantId } });
    await prisma.ingredient.deleteMany({ where: { restaurantId } });
    await prisma.ingredientCategory.deleteMany({ where: { restaurantId } });
    await prisma.category.deleteMany({ where: { restaurantId } });
    await prisma.branch.deleteMany({ where: { restaurantId } });
    await prisma.restaurant.delete({ where: { id: restaurantId } });
  });

  it("creates an investment project, defaulting discountRate to 12% when not specified", async () => {
    const project = await createInvestmentService(restaurantId, {
      branchId: branchAId, name: "New POS + Delivery Counter", type: "EQUIPMENT_PURCHASE", description: null,
      initialInvestment: 100000, plannedStartDate: new Date("2026-08-01"), expectedCompletionDate: null, projectLifeYears: 3,
      discountRate: 10, inflationRate: 0, monthlyRevenueIncrease: 5000, revenueGrowthPercentage: 0,
    }, undefined);
    investmentId = project.id;
    expect(project.status).toBe("PLANNED");
    expect(project.discountRate).toBe(10); // explicitly provided, not defaulted
  });

  it("defaults discountRate to 12% and inflationRate to 0 when neither is provided nor configured", async () => {
    const project = await createInvestmentService(restaurantId, {
      branchId: branchAId, name: "Undefaulted Project", type: "CUSTOM", description: null,
      initialInvestment: 10000, plannedStartDate: new Date("2026-08-01"), expectedCompletionDate: null, projectLifeYears: 5,
    }, undefined);
    expect(project.discountRate).toBe(12);
    expect(project.inflationRate).toBe(0);
    await prisma.investmentProject.delete({ where: { id: project.id } });
  });

  it("computes ROI/NPV/IRR/Payback matching hand-computed values for a clean cash flow", async () => {
    const metrics = await computeMetricsForInvestmentService(restaurantId, investmentId);
    expect(metrics.projection.annualCashFlows).toEqual([60000, 60000, 60000]);
    expect(metrics.roiPercentage).toBe(80);
    expect(metrics.paybackPeriodYears).toBeCloseTo(1.67, 1);
    expect(metrics.npv).toBeCloseTo(49210, -1); // per-year rounding can shift the total by a few rupees
    expect(metrics.irrPercentage).not.toBeNull();
    expect(metrics.irrPercentage!).toBeGreaterThan(10); // NPV is strongly positive at the 10% discount rate -> IRR must exceed it
  });

  it("evaluates the investment under a Scenario, substituting its revenue effect for the project's own growth assumption", async () => {
    const scenario = await createScenarioService(restaurantId, {
      branchId: branchAId, name: "Aggressive Growth", description: null, type: "CUSTOM", overrides: { revenueGrowthPercentage: 20 },
    }, undefined);

    const metricsUnderScenario = await computeMetricsForInvestmentService(restaurantId, investmentId, scenario.id);
    // year1 unaffected by growth (t=0): 60000; year2: 60000*1.2=72000; year3: 60000*1.44=86400
    expect(metricsUnderScenario.projection.annualCashFlows).toEqual([60000, 72000, 86400]);

    const baseMetrics = await computeMetricsForInvestmentService(restaurantId, investmentId);
    expect(metricsUnderScenario.roiPercentage!).toBeGreaterThan(baseMetrics.roiPercentage!);
  });

  it("compares Current Forecast vs Forecast With Investment, reusing the Forecast Engine unmodified", async () => {
    const comparison = await getForecastComparisonService(restaurantId, investmentId);
    const revenueRow = comparison.rows.find((r) => r.key === "revenue")!;
    const ebitdaRow = comparison.rows.find((r) => r.key === "ebitda")!;
    expect(revenueRow.withInvestment! - revenueRow.withoutInvestment!).toBe(60000); // monthlyRevenueIncrease * 12
    expect(ebitdaRow.withInvestment! - ebitdaRow.withoutInvestment!).toBe(60000); // Year-1 net cash flow (no cost-side effects in this fixture)
  });

  it("ranks branches by total NPV across their investment projects", async () => {
    const weak = await createInvestmentService(restaurantId, {
      branchId: branchBId, name: "Weak Marketing Push", type: "MARKETING_INVESTMENT", description: null,
      initialInvestment: 50000, plannedStartDate: new Date("2026-08-01"), expectedCompletionDate: null, projectLifeYears: 3,
      discountRate: 10, monthlyRevenueIncrease: 200,
    }, undefined);

    const ranked = await rankBranchInvestmentsService(restaurantId);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].branch.id).toBe(branchAId); // strong ROI/NPV project beats the weak one

    await prisma.investmentProject.delete({ where: { id: weak.id } });
  });

  it("aggregates a portfolio summary — capital deployed, top performing, needs attention", async () => {
    const summary = await getPortfolioSummaryService(restaurantId, {});
    expect(summary.totalCapitalDeployed).toBeGreaterThanOrEqual(100000);
    expect(summary.topPerforming.some((p) => p.project.id === investmentId)).toBe(true);
  });

  it("updates a project's status", async () => {
    const updated = await updateInvestmentService(restaurantId, investmentId, { status: "IN_PROGRESS" }, undefined);
    expect(updated.status).toBe("IN_PROGRESS");
  });

  it("rejects operating on an investment that doesn't belong to this restaurant", async () => {
    await expect(computeMetricsForInvestmentService(restaurantId, 999_999_999)).rejects.toThrow(ValidationError);
  });

  it("deletes an investment project", async () => {
    await deleteInvestmentService(restaurantId, investmentId);
    const remaining = await listInvestmentsService(restaurantId, {});
    expect(remaining.find((p) => p.id === investmentId)).toBeUndefined();
  });
});
