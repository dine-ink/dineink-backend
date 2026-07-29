// Integration test — hits the real configured database directly through the
// service layer (no mocking of Prisma). Creates its own isolated fixture
// restaurant and deletes every row it created afterward; never touches
// pre-existing data. Run via `npm run test:integration`, not the default
// `npm test` (see vitest.integration.config.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "../../config/prisma";
import {
  createBudgetService,
  duplicateBudgetService,
  getBudgetService,
  getBudgetVarianceService,
  listBudgetsService,
  updateBudgetService,
  upsertBudgetItemsService,
} from "./budget.service";

describe("Budget module — integration (real database)", () => {
  let restaurantId: number;
  let branchId: number;
  let menuItemId: number;
  let ingredientId: number;
  let fy: string;

  beforeAll(async () => {
    const restaurant = await prisma.restaurant.create({ data: { name: "Vitest Budget Integration Restaurant" } });
    restaurantId = restaurant.id;
    const branch = await prisma.branch.create({ data: { restaurantId, name: "Vitest Budget Integration Branch" } });
    branchId = branch.id;

    const category = await prisma.category.create({ data: { restaurantId, name: "Cat" } });
    const ingCategory = await prisma.ingredientCategory.create({ data: { restaurantId, name: "IngCat" } });
    const ingredient = await prisma.ingredient.create({
      data: { restaurantId, categoryId: ingCategory.id, name: "Bun", unit: "piece", pricePerUnit: 20, purchasePrice: 20 },
    });
    ingredientId = ingredient.id;
    const menuItem = await prisma.menuItem.create({
      data: { restaurantId, branchId: null, categoryId: category.id, name: "Burger", price: 200 },
    });
    menuItemId = menuItem.id;
    await prisma.menuItemIngredient.create({ data: { menuItemId, ingredientId, quantity: 1, unit: "piece" } });
    await prisma.restaurantInsights.create({ data: { restaurantId, branchId, monthlyRent: 15000 } });

    // 10 bills this month, 200 each = 2000 revenue, food cost 200 (10 dishes x 20 recipe cost)
    const today = new Date();
    for (let i = 0; i < 10; i++) {
      const bill = await prisma.bill.create({
        data: {
          billNo: `VITEST-BUDGET-${restaurantId}-${i}`,
          orderType: "DINE_IN",
          paymentMethod: "CASH",
          status: "PAID",
          subtotal: 200,
          gst: 0,
          discount: 0,
          total: 200,
          restaurantId,
          branchId,
          createdAt: today,
        },
      });
      await prisma.billItem.create({ data: { billId: bill.id, menuItemId, itemName: "Burger", quantity: 1, price: 200, total: 200 } });
    }

    fy = String(today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1);
  });

  afterAll(async () => {
    await prisma.budgetItem.deleteMany({ where: { budget: { restaurantId } } });
    await prisma.budget.deleteMany({ where: { restaurantId } });
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

  it("creates a budget with auto-generated monthly items for every category default given", async () => {
    const budget = await createBudgetService(restaurantId, {
      branchId,
      financialYear: fy,
      name: "Integration Test Budget",
      notes: null,
      monthlyDefaults: { revenue: 1800, foodCostPercentage: 20 },
    });
    expect(budget.items).toHaveLength(24); // 2 categories x 12 months
    expect(budget.status).toBe("DRAFT");
  });

  it("lists budgets scoped to the branch", async () => {
    const budgets = await listBudgetsService(restaurantId, { branchId });
    expect(budgets.length).toBeGreaterThanOrEqual(1);
    expect(budgets[0].branchId).toBe(branchId);
  });

  it("edits an individual month's item without touching the others", async () => {
    const budgets = await listBudgetsService(restaurantId, { branchId });
    const budgetId = budgets[0].id;
    const today = new Date();

    const updated = await upsertBudgetItemsService(
      restaurantId,
      budgetId,
      [{ category: "revenue", year: today.getFullYear(), month: today.getMonth() + 1, amount: 2200 }],
      undefined,
    );
    const thisMonthItem = updated.items.find(
      (i) => i.category === "revenue" && i.year === today.getFullYear() && i.month === today.getMonth() + 1,
    );
    expect(thisMonthItem?.amount).toBe(2200);

    // A different month must be untouched
    const otherMonth = ((today.getMonth() + 1) % 12) + 1;
    const otherYear = otherMonth === 1 && today.getMonth() + 1 === 12 ? today.getFullYear() + 1 : today.getFullYear();
    const otherMonthItem = updated.items.find((i) => i.category === "revenue" && i.year === otherYear && i.month === otherMonth);
    expect(otherMonthItem?.amount).toBe(1800);
  });

  it("publishes a budget via status update", async () => {
    const budgets = await listBudgetsService(restaurantId, { branchId });
    const budget = await updateBudgetService(restaurantId, budgets[0].id, { status: "PUBLISHED" }, undefined);
    expect(budget.status).toBe("PUBLISHED");
  });

  it("computes variance matching hand-calculated actuals from the shared finance engine", async () => {
    const budgets = await listBudgetsService(restaurantId, { branchId });
    const report = await getBudgetVarianceService(restaurantId, budgets[0].id, "currentMonth");
    const byCategory = Object.fromEntries(report.rows.map((r) => [r.category, r]));

    // Revenue: actual 2000 (10 bills x 200), budget 2200 (edited above)
    expect(byCategory.revenue.actual).toBe(2000);
    expect(byCategory.revenue.budget).toBe(2200);
    expect(byCategory.revenue.variance).toBe(-200);

    // Food cost %: actual 10% (200 food cost / 2000 revenue), budget 20%
    expect(byCategory.foodCostPercentage.actual).toBe(10);
    expect(byCategory.foodCostPercentage.budget).toBe(20);
    // Beating a lower-is-better target of 20% while actually at 10% => 200% achievement
    expect(byCategory.foodCostPercentage.achievementPercentage).toBe(200);
    expect(byCategory.foodCostPercentage.status).toBe("on-track");

    // Categories with no budget item set at all report null, not 0
    expect(byCategory.ebitda.budget).toBeNull();
    expect(byCategory.ebitda.status).toBe("no-data");

    // Categories with no actual-value source at all (Cleaning, Cash Flow)
    expect(byCategory.cleaning.actual).toBeNull();
    expect(byCategory.cashFlow.actual).toBeNull();
  });

  it("duplicates a budget with all items copied and status reset to DRAFT", async () => {
    const budgets = await listBudgetsService(restaurantId, { branchId });
    const original = budgets[0];
    const copy = await duplicateBudgetService(restaurantId, original.id, { name: "Duplicated Budget" }, undefined);

    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe("Duplicated Budget");
    expect(copy.status).toBe("DRAFT");
    expect(copy.items).toHaveLength(24);
  });

  it("copying to a new financial year shifts every item's year by the FY delta", async () => {
    const budgets = await listBudgetsService(restaurantId, { branchId });
    const originalSummary = budgets.find((b: any) => b.name === "Integration Test Budget")!;
    const original = await getBudgetService(restaurantId, originalSummary.id);
    const nextFy = String(Number(fy) + 1);

    const copy = await duplicateBudgetService(restaurantId, original.id, { financialYear: nextFy }, undefined);
    expect(copy.financialYear).toBe(nextFy);

    const originalAprItem = original.items.find((i) => i.category === "revenue" && i.month === 4);
    const copyAprItem = copy.items.find((i) => i.category === "revenue" && i.month === 4);
    expect(copyAprItem?.year).toBe((originalAprItem?.year ?? Number(fy)) + 1);
  });
});
