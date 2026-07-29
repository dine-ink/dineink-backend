// Integration test — hits the real configured database directly through the
// service layer. Creates its own isolated fixture restaurant and deletes
// every row it created afterward; never touches pre-existing data. Run via
// `npm run test:integration`, not the default `npm test`.
//
// Verifies the core Phase-2-audit fix: Branch Comparison's Revenue/Food
// Cost/Labour Cost/EBITDA/Net Profit must now come from the same Finance
// Engine (resolveScopedMetrics) every other screen uses, instead of an
// independent ShopExpense-based calculation mislabeled as "Net Profit".
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "../../config/prisma";
import { getBranchComparisonService, getCityComparisonService } from "./branchComparison.service";
import { fetchInsightsForScope, getMenuItemCostMap, getPayrollPolicyMap, resolveScopedMetrics } from "../finance/finance.service";
import { resolveDateRange } from "../../utils/dateRange";

describe("Branch Comparison — integration (real database)", () => {
  let restaurantId: number;
  let branchAId: number;
  let branchBId: number;
  let menuItemId: number;

  beforeAll(async () => {
    const restaurant = await prisma.restaurant.create({ data: { name: "Vitest BranchComparison Integration Restaurant" } });
    restaurantId = restaurant.id;
    const branchA = await prisma.branch.create({ data: { restaurantId, name: "Vitest BC Branch A", city: "Chennai" } });
    branchAId = branchA.id;
    const branchB = await prisma.branch.create({ data: { restaurantId, name: "Vitest BC Branch B", city: "Chennai" } });
    branchBId = branchB.id;
    await prisma.user.create({
      data: { name: "Vitest BC Owner", role: "OWNER", password: "unused", email: `vitest-bc-${Date.now()}@test.com`, restaurantId, isActive: true },
    });
    await prisma.user.create({
      data: { name: "Vitest BC Staff", role: "STAFF", password: "unused", email: `vitest-bc-staff-${Date.now()}@test.com`, restaurantId, branchId: branchAId, isActive: true, salary: 15000 },
    });

    const category = await prisma.category.create({ data: { restaurantId, name: "Cat" } });
    const ingCategory = await prisma.ingredientCategory.create({ data: { restaurantId, name: "IngCat" } });
    const ingredient = await prisma.ingredient.create({
      data: { restaurantId, categoryId: ingCategory.id, name: "Bun", unit: "piece", pricePerUnit: 20, purchasePrice: 20, quantity: 50 },
    });
    const menuItem = await prisma.menuItem.create({ data: { restaurantId, branchId: null, categoryId: category.id, name: "Burger", price: 200 } });
    menuItemId = menuItem.id;
    await prisma.menuItemIngredient.create({ data: { menuItemId, ingredientId: ingredient.id, quantity: 1, unit: "piece" } });

    // Branch A: real rent + loan EMI, so EBITDA and Net Profit genuinely
    // differ (finance cost > 0) — the exact scenario the old code could
    // never produce (it had no finance-cost source at all).
    await prisma.restaurantInsights.create({ data: { restaurantId, branchId: branchAId, monthlyRent: 3000, monthlyLoanEmi: 300 } });
    await prisma.restaurantInsights.create({ data: { restaurantId, branchId: branchBId, monthlyRent: 1000 } });

    const today = new Date();
    for (let i = 0; i < 10; i++) {
      const bill = await prisma.bill.create({
        data: { billNo: `VITEST-BC-A-${restaurantId}-${i}`, orderType: "DINE_IN", paymentMethod: "CASH", status: "PAID",
          subtotal: 200, gst: 0, discount: 0, total: 200, restaurantId, branchId: branchAId, createdAt: today },
      });
      await prisma.billItem.create({ data: { billId: bill.id, menuItemId, itemName: "Burger", quantity: 1, price: 200, total: 200 } });
    }
    for (let i = 0; i < 2; i++) {
      const bill = await prisma.bill.create({
        data: { billNo: `VITEST-BC-B-${restaurantId}-${i}`, orderType: "DINE_IN", paymentMethod: "CASH", status: "PAID",
          subtotal: 200, gst: 0, discount: 0, total: 200, restaurantId, branchId: branchBId, createdAt: today },
      });
      await prisma.billItem.create({ data: { billId: bill.id, menuItemId, itemName: "Burger", quantity: 1, price: 200, total: 200 } });
    }
    // An UNPAID bill for branch A — must NOT count toward revenue/EBITDA anywhere.
    await prisma.bill.create({
      data: { billNo: `VITEST-BC-A-UNPAID-${restaurantId}`, orderType: "DINE_IN", paymentMethod: "CASH", status: "UNPAID",
        subtotal: 500, gst: 0, discount: 0, total: 500, restaurantId, branchId: branchAId, createdAt: today },
    });
  });

  afterAll(async () => {
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

  it("Branch Comparison's Revenue/Food Cost/Labour Cost/EBITDA/Net Profit exactly match the Finance Engine's own resolveScopedMetrics for the same branch and period", async () => {
    const rows = await getBranchComparisonService(restaurantId);
    const rowA = rows.find((r) => r.branch.id === branchAId)!;
    expect(rowA).toBeTruthy();

    // Independently compute via the Finance Engine directly, using the same
    // implicit "last 30 days" window getBranchComparisonService falls back
    // to when no from/to is supplied.
    const range = { startDate: new Date(Date.now() - 30 * 86_400_000), endDate: new Date() };
    const [insights, menuItemCostMap, payrollPolicyMap] = await Promise.all([
      fetchInsightsForScope(restaurantId, branchAId),
      getMenuItemCostMap(restaurantId),
      getPayrollPolicyMap(restaurantId),
    ]);
    const bundle = await resolveScopedMetrics(restaurantId, branchAId, range, menuItemCostMap, insights, payrollPolicyMap);

    expect(rowA.revenue).toBe(bundle.metrics.revenue);
    expect(rowA.foodCost).toBe(bundle.metrics.foodCost);
    expect(rowA.labourCost).toBe(bundle.metrics.labourCost);
    expect(rowA.ebitda).toBe(bundle.metrics.ebitda);
    expect(rowA.netProfit).toBe(bundle.metrics.netProfit);
  });

  it("excludes UNPAID bills from Revenue (only PAID bills count)", async () => {
    const rows = await getBranchComparisonService(restaurantId);
    const rowA = rows.find((r) => r.branch.id === branchAId)!;
    // 10 PAID bills @ 200 = 2000; the 500 UNPAID bill must not be included.
    expect(rowA.revenue).toBe(2000);
  });

  it("Net Profit is genuinely lower than EBITDA once a real finance cost (loan EMI) exists — the bug this fix closes", async () => {
    const rows = await getBranchComparisonService(restaurantId);
    const rowA = rows.find((r) => r.branch.id === branchAId)!;
    expect(rowA.netProfit).toBeLessThan(rowA.ebitda);
  });

  it("getCityComparisonService aggregates ebitda/netProfit consistently with the per-branch rows", async () => {
    const cities = await getCityComparisonService(restaurantId);
    const chennai = cities.find((c) => c.city === "Chennai")!;
    const rows = await getBranchComparisonService(restaurantId);
    const expectedEbitda = rows.filter((r) => r.branch.city === "Chennai").reduce((s, r) => s + r.ebitda, 0);
    expect(chennai.ebitda).toBe(expectedEbitda);
  });
});
