// Integration test — hits the real configured database directly through the
// service layer (no mocking of Prisma). Creates its own isolated fixture
// restaurant and deletes every row it created afterward; never touches
// pre-existing data. Run via `npm run test:integration`, not the default
// `npm test` (see vitest.integration.config.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "../../config/prisma";
import {
  deleteKpiTargetService,
  getBusinessHealthScoreService,
  getDashboardPreferenceService,
  getExecutiveAlertsService,
  getExecutiveOverviewService,
  getExecutiveTimelineService,
  getInsightPanelsService,
  getKpiScorecardsService,
  getMultiBranchExecutiveViewService,
  listKpiTargetsService,
  resolveKpiTargetService,
  saveDashboardPreferenceService,
  setKpiTargetService,
} from "./executive.service";
import { ValidationError } from "./executive.validation";

describe("Executive module — integration (real database)", () => {
  let restaurantId: number;
  let branchAId: number;
  let branchBId: number;
  let ownerId: number;
  let menuItemId: number;

  beforeAll(async () => {
    const restaurant = await prisma.restaurant.create({ data: { name: "Vitest Executive Integration Restaurant" } });
    restaurantId = restaurant.id;
    const branchA = await prisma.branch.create({ data: { restaurantId, name: "Vitest Executive Branch A" } });
    branchAId = branchA.id;
    const branchB = await prisma.branch.create({ data: { restaurantId, name: "Vitest Executive Branch B" } });
    branchBId = branchB.id;
    const owner = await prisma.user.create({
      data: { name: "Vitest Executive Owner", role: "OWNER", password: "unused", email: `vitest-executive-${Date.now()}@test.com`, restaurantId, isActive: true },
    });
    ownerId = owner.id;
    await prisma.user.create({
      data: { name: "Vitest Executive Staff", role: "STAFF", password: "unused", email: `vitest-executive-staff-${Date.now()}@test.com`, restaurantId, branchId: branchAId, isActive: true },
    });

    const category = await prisma.category.create({ data: { restaurantId, name: "Cat" } });
    const ingCategory = await prisma.ingredientCategory.create({ data: { restaurantId, name: "IngCat" } });
    const ingredient = await prisma.ingredient.create({
      data: { restaurantId, categoryId: ingCategory.id, name: "Bun", unit: "piece", pricePerUnit: 20, purchasePrice: 20, quantity: 50 },
    });
    const menuItem = await prisma.menuItem.create({
      data: { restaurantId, branchId: null, categoryId: category.id, name: "Burger", price: 200 },
    });
    menuItemId = menuItem.id;
    await prisma.menuItemIngredient.create({ data: { menuItemId, ingredientId: ingredient.id, quantity: 1, unit: "piece" } });
    await prisma.restaurantInsights.create({ data: { restaurantId, branchId: branchAId, monthlyRent: 3000 } });
    await prisma.restaurantInsights.create({ data: { restaurantId, branchId: branchBId, monthlyRent: 1000 } });

    const today = new Date();
    for (let i = 0; i < 10; i++) {
      const bill = await prisma.bill.create({
        data: { billNo: `VITEST-EXEC-A-${restaurantId}-${i}`, orderType: "DINE_IN", paymentMethod: "CASH", status: "PAID",
          subtotal: 200, gst: 0, discount: 0, total: 200, restaurantId, branchId: branchAId, createdAt: today },
      });
      await prisma.billItem.create({ data: { billId: bill.id, menuItemId, itemName: "Burger", quantity: 1, price: 200, total: 200 } });
    }
    for (let i = 0; i < 2; i++) {
      const bill = await prisma.bill.create({
        data: { billNo: `VITEST-EXEC-B-${restaurantId}-${i}`, orderType: "DINE_IN", paymentMethod: "CASH", status: "PAID",
          subtotal: 200, gst: 0, discount: 0, total: 200, restaurantId, branchId: branchBId, createdAt: today },
      });
      await prisma.billItem.create({ data: { billId: bill.id, menuItemId, itemName: "Burger", quantity: 1, price: 200, total: 200 } });
    }
  });

  afterAll(async () => {
    await prisma.userDashboardPreference.deleteMany({ where: { restaurantId } });
    await prisma.executiveKpiTarget.deleteMany({ where: { restaurantId } });
    await prisma.financialScenario.deleteMany({ where: { restaurantId } }); // getInsightPanelsService reuses listScenariosService, which auto-creates built-ins
    await prisma.billItem.deleteMany({ where: { bill: { restaurantId } } });
    await prisma.bill.deleteMany({ where: { restaurantId } });
    await prisma.restaurantInsights.deleteMany({ where: { restaurantId } });
    await prisma.menuItemIngredient.deleteMany({ where: { menuItemId } });
    await prisma.menuItem.deleteMany({ where: { restaurantId } });
    await prisma.ingredient.deleteMany({ where: { restaurantId } });
    await prisma.ingredientCategory.deleteMany({ where: { restaurantId } });
    await prisma.category.deleteMany({ where: { restaurantId } });
    await prisma.user.deleteMany({ where: { restaurantId } });
    await prisma.branch.deleteMany({ where: { restaurantId } });
    await prisma.restaurant.delete({ where: { id: restaurantId } });
  });

  it("computes Overview KPIs matching hand-computed actuals for Branch A", async () => {
    const overview = await getExecutiveOverviewService(restaurantId, branchAId, "currentMonth");
    const byKey = Object.fromEntries(overview.kpis.map((k) => [k.key, k]));
    expect(byKey.revenue.current).toBe(2000);
    expect(byKey.orders.current).toBe(10);
    expect(byKey.foodCostPercentage.current).toBe(10);
    expect(byKey.branchCount.current).toBe(2);
    expect(byKey.activeEmployees.current).toBe(1);
    expect(byKey.inventoryValue.current).toBe(1000); // 50 qty * 20 price
  });

  it("resolves a restaurant-default KPI target, then a branch override winning over it, then falling back after deletion", async () => {
    await setKpiTargetService(restaurantId, null, "revenue", 1800, ownerId);
    expect(await resolveKpiTargetService(restaurantId, branchAId, "revenue", null)).toBe(1800);

    await setKpiTargetService(restaurantId, branchAId, "revenue", 2500, ownerId);
    expect(await resolveKpiTargetService(restaurantId, branchAId, "revenue", null)).toBe(2500);

    await deleteKpiTargetService(restaurantId, branchAId, "revenue");
    expect(await resolveKpiTargetService(restaurantId, branchAId, "revenue", null)).toBe(1800);

    const targets = await listKpiTargetsService(restaurantId);
    expect(targets.some((t) => t.kpiKey === "revenue" && t.branchId === null)).toBe(true);
  });

  it("builds KPI Scorecards with Budget and Forecast columns alongside the shared Overview fields", async () => {
    const scorecards = await getKpiScorecardsService(restaurantId, branchAId, "currentMonth");
    expect(scorecards).toHaveLength(7);
    expect(scorecards.every((r) => "budget" in r && "forecast" in r)).toBe(true);
  });

  it("computes a Business Health Score with 10 categories, redistributing weight when Branch Performance has no data for a single branch", async () => {
    const health = await getBusinessHealthScoreService(restaurantId, branchAId, "currentMonth");
    expect(health.overall).toBeGreaterThanOrEqual(0);
    expect(health.overall).toBeLessThanOrEqual(100);
    expect(health.categories).toHaveLength(10);
    expect(health.categories.find((c) => c.key === "branchPerformance")!.status).toBe("no-data");
  });

  it("computes Branch Performance restaurant-wide by averaging each branch's own health score", async () => {
    const health = await getBusinessHealthScoreService(restaurantId, null, "currentMonth");
    expect(health.categories.find((c) => c.key === "branchPerformance")!.status).not.toBe("no-data");
  });

  it("ranks branches in the Multi-Branch view, flagging best/lowest/most-improved", async () => {
    const view = await getMultiBranchExecutiveViewService(restaurantId, "currentMonth");
    expect(view.branches).toHaveLength(2);
    expect(view.bestPerforming!.branch.id).toBe(branchAId); // 10 bills vs 2 -> clearly ahead
    expect(view.lowestPerforming!.branch.id).toBe(branchBId);
  });

  it("builds a 12-point monthly timeline whose most recent point matches this month's actuals", async () => {
    const timeline = await getExecutiveTimelineService(restaurantId, branchAId, "monthly");
    expect(timeline.points).toHaveLength(12);
    expect(timeline.points[11].revenue).toBe(2000);
    expect(Array.isArray(timeline.investmentTimeline)).toBe(true);
  });

  it("generates alerts with the required severity/impact/recommendedAction/linkTo shape", async () => {
    const alerts = await getExecutiveAlertsService(restaurantId, branchAId, "currentMonth");
    expect(alerts.every((a) => a.severity && a.impact && a.recommendedAction && a.linkTo)).toBe(true);
  });

  it("composes Insight Panels purely from existing engine outputs", async () => {
    const panels = await getInsightPanelsService(restaurantId, branchAId, "currentMonth");
    expect(panels.forecastSummary).toBeTruthy();
    expect(panels.investmentPortfolioSummary).toBeTruthy();
    expect(Array.isArray(panels.scenarioSummary)).toBe(true);
  });

  it("saves and reloads a user's dashboard preferences", async () => {
    await saveDashboardPreferenceService(ownerId, restaurantId, { pinnedKpis: ["revenue", "ebitda"], defaultPeriod: "currentQuarter" });
    const loaded = await getDashboardPreferenceService(ownerId);
    expect(loaded?.defaultPeriod).toBe("currentQuarter");
    expect(loaded?.pinnedKpis).toEqual(["revenue", "ebitda"]);
  });

  it("rejects an invalid KPI key at the validation layer", async () => {
    const { validateKpiKey } = await import("./executive.validation");
    expect(() => validateKpiKey("notARealKpi")).toThrow(ValidationError);
  });
});
