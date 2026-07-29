// Integration test — hits the real configured database directly through the
// service layer (no mocking of Prisma). Creates its own isolated fixture
// restaurant and deletes every row it created afterward; never touches
// pre-existing data. Run via `npm run test:integration`, not the default
// `npm test` (see vitest.integration.config.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "../../config/prisma";
import {
  cloneScenarioService,
  createScenarioService,
  deleteScenarioService,
  getScenarioService,
  listScenariosService,
  resetScenarioFieldsService,
  runWhatIfService,
  updateScenarioService,
} from "./scenario.service";
import { ValidationError } from "./scenario.validation";

describe("Scenario module — integration (real database)", () => {
  let restaurantId: number;
  let branchAId: number;
  let branchBId: number;
  let menuItemId: number;

  beforeAll(async () => {
    const restaurant = await prisma.restaurant.create({ data: { name: "Vitest Scenario Integration Restaurant" } });
    restaurantId = restaurant.id;
    const branchA = await prisma.branch.create({ data: { restaurantId, name: "Vitest Scenario Branch A" } });
    branchAId = branchA.id;
    const branchB = await prisma.branch.create({ data: { restaurantId, name: "Vitest Scenario Branch B" } });
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

    await prisma.restaurantInsights.create({
      data: {
        restaurantId, branchId: branchAId,
        monthlyRent: 15000, electricity: 3000, gas: 1500, marketingSpend: 3000, maintenance: 1000, packaging: 500, aggregatorCommission: 200,
      },
    });
    await prisma.restaurantInsights.create({ data: { restaurantId, branchId: branchBId, monthlyRent: 6000, electricity: 1000 } });

    const today = new Date();
    for (let i = 0; i < 10; i++) {
      const bill = await prisma.bill.create({
        data: { billNo: `VITEST-SCEN-A-${restaurantId}-${i}`, orderType: "DINE_IN", paymentMethod: "CASH", status: "PAID",
          subtotal: 200, gst: 0, discount: 0, total: 200, restaurantId, branchId: branchAId, createdAt: today },
      });
      await prisma.billItem.create({ data: { billId: bill.id, menuItemId, itemName: "Burger", quantity: 1, price: 200, total: 200 } });
    }
    for (let i = 0; i < 4; i++) {
      const bill = await prisma.bill.create({
        data: { billNo: `VITEST-SCEN-B-${restaurantId}-${i}`, orderType: "DINE_IN", paymentMethod: "CASH", status: "PAID",
          subtotal: 200, gst: 0, discount: 0, total: 200, restaurantId, branchId: branchBId, createdAt: today },
      });
      await prisma.billItem.create({ data: { billId: bill.id, menuItemId, itemName: "Burger", quantity: 1, price: 200, total: 200 } });
    }
  });

  afterAll(async () => {
    await prisma.financialScenario.deleteMany({ where: { restaurantId } });
    await prisma.billItem.deleteMany({ where: { bill: { restaurantId } } });
    await prisma.bill.deleteMany({ where: { restaurantId } });
    await prisma.restaurantInsights.deleteMany({ where: { restaurantId } });
    await prisma.menuItemIngredient.deleteMany({ where: { menuItemId } });
    await prisma.menuItem.deleteMany({ where: { restaurantId } });
    await prisma.ingredient.deleteMany({ where: { restaurantId } });
    await prisma.ingredientCategory.deleteMany({ where: { restaurantId } });
    await prisma.category.deleteMany({ where: { restaurantId } });
    await prisma.branch.deleteMany({ where: { restaurantId } });
    await prisma.restaurant.delete({ where: { id: restaurantId } });
  });

  it("auto-creates Conservative/Expected/Optimistic built-ins on first list, idempotently", async () => {
    const first = await listScenariosService(restaurantId, { branchId: branchAId });
    const types = first.map((s) => s.type);
    expect(types).toEqual(expect.arrayContaining(["CONSERVATIVE", "EXPECTED", "OPTIMISTIC"]));

    const second = await listScenariosService(restaurantId, { branchId: branchAId });
    expect(second).toHaveLength(3); // no duplicate built-ins created by a second list call
  });

  it("creates a custom scenario with the given overrides", async () => {
    const scenario = await createScenarioService(
      restaurantId,
      { branchId: branchAId, name: "Aggressive Growth", description: null, type: "CUSTOM",
        overrides: { revenueGrowthPercentage: 10, foodCostTargetPercentage: 15, rent: 20000 } },
      undefined,
    );
    expect(scenario.type).toBe("CUSTOM");
    expect(scenario.revenueGrowthPercentage).toBe(10);
    expect(scenario.rent).toBe(20000);
  });

  it("projects KPIs through the shared Finance Engine without persisting anything", async () => {
    const scenario = (await listScenariosService(restaurantId, { branchId: branchAId })).find((s) => s.name === "Aggressive Growth")!;
    const result = await runWhatIfService(restaurantId, scenario.id, "currentMonth");
    const kpis = Object.fromEntries(result.kpis.map((k) => [k.key, k]));

    // Baseline (branch A, this month): revenue 2000, orders 10, foodCost 200 (10%).
    expect(kpis.revenue.baseline).toBe(2000);
    expect(kpis.orders.baseline).toBe(10);
    // revenueGrowthPercentage 10% -> 2200; foodCostTargetPercentage 15% -> 330
    expect(kpis.revenue.projected).toBe(2200);
    expect(kpis.foodCost.projected).toBe(330);
    expect(kpis.foodCostPercentage.projected).toBeCloseTo(15, 1);
    // Labour is semi-fixed — no override set, so it stays at baseline (0), not scaled with revenue.
    expect(kpis.labour.baseline).toBe(0);
    expect(kpis.labour.projected).toBe(0);

    // Confirm nothing computed was written back to real data: actuals must be identical on a second call.
    const second = await runWhatIfService(restaurantId, scenario.id, "currentMonth");
    const secondKpis = Object.fromEntries(second.kpis.map((k) => [k.key, k]));
    expect(secondKpis.revenue.baseline).toBe(2000);
  });

  it("applies live (unsaved) overrides for the interactive what-if sliders without persisting them", async () => {
    const scenario = (await listScenariosService(restaurantId, { branchId: branchAId })).find((s) => s.name === "Aggressive Growth")!;
    const withLiveOverride = await runWhatIfService(restaurantId, scenario.id, "currentMonth", undefined, undefined, { labourTargetPercentage: 20 });
    const liveLabour = withLiveOverride.kpis.find((k) => k.key === "labour");
    expect(liveLabour?.projected).toBe(440); // 20% of 2200 projected revenue

    const reloaded = await getScenarioService(restaurantId, scenario.id);
    expect(reloaded.labourTargetPercentage).toBeNull(); // the live override was never saved
  });

  it("resets an individual override field back to null (inherited)", async () => {
    const scenario = (await listScenariosService(restaurantId, { branchId: branchAId })).find((s) => s.name === "Aggressive Growth")!;
    const updated = await resetScenarioFieldsService(restaurantId, scenario.id, ["rent"], undefined);
    expect(updated.rent).toBeNull();
    expect(updated.foodCostTargetPercentage).toBe(15); // untouched fields survive the reset

    const result = await runWhatIfService(restaurantId, scenario.id, "currentMonth");
    const rentRow = result.kpis.find((k) => k.key === "rent");
    expect(rentRow?.projected).toBe(rentRow?.baseline); // falls back to baseline rent once the override is cleared
  });

  it("clones a scenario with its overrides carried over, as a new CUSTOM row", async () => {
    const scenario = (await listScenariosService(restaurantId, { branchId: branchAId })).find((s) => s.name === "Aggressive Growth")!;
    const clone = await cloneScenarioService(restaurantId, scenario.id, {}, undefined);
    expect(clone.id).not.toBe(scenario.id);
    expect(clone.type).toBe("CUSTOM");
    expect(clone.foodCostTargetPercentage).toBe(15);
    expect(clone.name).toBe("Aggressive Growth (Copy)");
  });

  it("updates a scenario's name/description/isActive", async () => {
    const scenario = (await listScenariosService(restaurantId, { branchId: branchAId })).find((s) => s.name === "Aggressive Growth")!;
    const updated = await updateScenarioService(restaurantId, scenario.id, { name: "Renamed Scenario", isActive: false }, undefined);
    expect(updated.name).toBe("Renamed Scenario");
    expect(updated.isActive).toBe(false);
  });

  it("rejects deleting a built-in scenario but allows deleting a custom one", async () => {
    const scenarios = await listScenariosService(restaurantId, { branchId: branchAId });
    const conservative = scenarios.find((s) => s.type === "CONSERVATIVE")!;
    const custom = scenarios.find((s) => s.name === "Renamed Scenario")!;

    await expect(deleteScenarioService(restaurantId, conservative.id)).rejects.toThrow(ValidationError);
    await expect(deleteScenarioService(restaurantId, custom.id)).resolves.toBeUndefined();

    const remaining = await listScenariosService(restaurantId, { branchId: branchAId });
    expect(remaining.find((s) => s.id === custom.id)).toBeUndefined();
  });

  it("aggregates across every branch for a restaurant-wide scenario (branchId null)", async () => {
    const restScenario = await createScenarioService(
      restaurantId,
      { branchId: null, name: "Restaurant-wide Scale-up", description: null, type: "CUSTOM", overrides: { orderGrowthPercentage: 20 } },
      undefined,
    );
    const result = await runWhatIfService(restaurantId, restScenario.id, "currentMonth");
    const kpis = Object.fromEntries(result.kpis.map((k) => [k.key, k]));

    // Branch A (10 orders, 2000 revenue) + Branch B (4 orders, 800 revenue)
    expect(kpis.revenue.baseline).toBe(2800);
    expect(kpis.orders.baseline).toBe(14);
    expect(kpis.orders.projected).toBe(17); // round(14 * 1.2) = 16.8 -> 17
    // No revenueGrowthPercentage set -> revenue follows orders x AOV (baseline AOV 200)
    expect(kpis.revenue.projected).toBe(3400); // 17 * 200
  });

  it("rejects a scenario id that doesn't belong to this restaurant", async () => {
    await expect(getScenarioService(restaurantId, 999_999_999)).rejects.toThrow(ValidationError);
  });
});
