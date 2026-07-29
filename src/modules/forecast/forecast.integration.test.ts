// Integration test — hits the real configured database directly through the
// service layer (no mocking of Prisma). Creates its own isolated fixture
// restaurant and deletes every row it created afterward; never touches
// pre-existing data. Run via `npm run test:integration`, not the default
// `npm test` (see vitest.integration.config.ts).
//
// Fixture: a perfectly linear 3-month trend (April 5 bills, May 7, June 9 —
// all @ 200 with a 20 recipe cost each) so every prediction below is
// hand-computable exactly, not just "close to" a value. See
// PHASE5_FORECASTING_REPORT.md for the full worked arithmetic.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "../../config/prisma";
import {
  generateForecastService,
  getForecastAccuracyReportService,
  getForecastVsActualService,
  listForecastSnapshotsService,
  rankBranchForecastsService,
} from "./forecast.service";

describe("Forecast module — integration (real database)", () => {
  let restaurantId: number;
  let branchAId: number;
  let branchBId: number;
  let menuItemId: number;

  beforeAll(async () => {
    const restaurant = await prisma.restaurant.create({ data: { name: "Vitest Forecast Integration Restaurant", createdAt: new Date(2026, 3, 1) } });
    restaurantId = restaurant.id;
    const branchA = await prisma.branch.create({ data: { restaurantId, name: "Vitest Forecast Branch A", createdAt: new Date(2026, 3, 1) } });
    branchAId = branchA.id;
    const branchB = await prisma.branch.create({ data: { restaurantId, name: "Vitest Forecast Branch B", createdAt: new Date(2026, 3, 1) } });
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

    const monthlyBillCounts = [
      { year: 2026, month: 4, count: 5 },
      { year: 2026, month: 5, count: 7 },
      { year: 2026, month: 6, count: 9 },
    ];
    for (const { year, month, count } of monthlyBillCounts) {
      for (let i = 0; i < count; i++) {
        const createdAt = new Date(year, month - 1, 10, 12, 0, 0);
        const bill = await prisma.bill.create({
          data: { billNo: `VITEST-FCST-A-${restaurantId}-${year}-${month}-${i}`, orderType: "DINE_IN", paymentMethod: "CASH", status: "PAID",
            subtotal: 200, gst: 0, discount: 0, total: 200, restaurantId, branchId: branchAId, createdAt },
        });
        await prisma.billItem.create({ data: { billId: bill.id, menuItemId, itemName: "Burger", quantity: 1, price: 200, total: 200 } });
      }
      for (let i = 0; i < 3; i++) {
        const createdAt = new Date(year, month - 1, 10, 12, 0, 0);
        const bill = await prisma.bill.create({
          data: { billNo: `VITEST-FCST-B-${restaurantId}-${year}-${month}-${i}`, orderType: "DINE_IN", paymentMethod: "CASH", status: "PAID",
            subtotal: 200, gst: 0, discount: 0, total: 200, restaurantId, branchId: branchBId, createdAt },
        });
        await prisma.billItem.create({ data: { billId: bill.id, menuItemId, itemName: "Burger", quantity: 1, price: 200, total: 200 } });
      }
    }
  });

  afterAll(async () => {
    await prisma.financialForecast.deleteMany({ where: { restaurantId } });
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

  it("forecasts Next Month from a clean 3-month linear trend, matching hand-computed regression", async () => {
    const result = await generateForecastService(restaurantId, branchAId, "NEXT_MONTH", "HISTORICAL_TREND", undefined, false);
    const byKey = Object.fromEntries(result.kpis.map((k) => [k.key, k]));

    expect(result.historicalPeriodsUsed).toBe(3);
    expect(result.modelUsed).toBe("HISTORICAL_TREND");
    expect(result.overallConfidence).toBe("medium"); // only 3 periods -> capped below "high" regardless of stability

    // orders [5,7,9] -> slope 2, intercept 5 -> predicted 5+2*3=11; revenue [1000,1400,1800] -> predicted 2200; foodCost [100,140,180] -> predicted 220
    expect(byKey.orders.predicted).toBe(11);
    expect(byKey.revenue.predicted).toBe(2200);
    expect(byKey.foodCost.predicted).toBe(220);
    expect(byKey.foodCostPercentage.predicted).toBeCloseTo(10, 5);
    expect(byKey.labourCost.predicted).toBe(0); // no historical labour data anywhere -> flat 0, not fabricated

    // EBITDA = revenue - foodCost (no labour/fixed/variable costs in this fixture) = 2200 - 220 = 1980
    expect(byKey.ebitda.predicted).toBe(1980);
    expect(byKey.netProfit.predicted).toBe(1980);
    expect(byKey.breakEvenRevenue.predicted).toBe(0); // zero fixed/labour/finance cost -> nothing to break even against

    expect(byKey.revenue.baseline).toBe(1800); // June, the most recent complete month
    expect(byKey.revenue.trendDirection).toBe("up");
    expect(byKey.revenue.variancePercentage).toBeCloseTo(22.2, 1);
  });

  it("fires exactly one alert — 'sales trending upward' — for a cleanly rising trend with no cost pressure", async () => {
    const result = await generateForecastService(restaurantId, branchAId, "NEXT_MONTH", "HISTORICAL_TREND", undefined, false);
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].key).toBe("revenue");
    expect(result.alerts[0].severity).toBe("info");
  });

  it("downgrades a requested Seasonal model to Historical Trend when fewer than 13 months exist, and explains why", async () => {
    const result = await generateForecastService(restaurantId, branchAId, "NEXT_MONTH", "SEASONAL", undefined, false);
    expect(result.modelUsed).toBe("HISTORICAL_TREND");
    expect(result.confidenceReasons.some((r) => /seasonal forecasting needs/i.test(r))).toBe(true);
  });

  it("persists a snapshot on generate, idempotently — a second call for the same target period does not duplicate it", async () => {
    await generateForecastService(restaurantId, branchAId, "NEXT_MONTH", "HISTORICAL_TREND", undefined, true);
    await generateForecastService(restaurantId, branchAId, "NEXT_MONTH", "HISTORICAL_TREND", undefined, true);

    const snapshots = await listForecastSnapshotsService(restaurantId, { branchId: branchAId, periodType: "NEXT_MONTH" });
    expect(snapshots).toHaveLength(1);
  });

  it("reports isComplete=false and actual=null for a forecast whose target period hasn't happened yet", async () => {
    const snapshots = await listForecastSnapshotsService(restaurantId, { branchId: branchAId, periodType: "NEXT_MONTH" });
    const comparison = await getForecastVsActualService(restaurantId, snapshots[0].id);
    expect(comparison.isComplete).toBe(false);
    const revenueRow = comparison.rows.find((r) => r.key === "revenue");
    expect(revenueRow?.actual).toBeNull();
    expect(revenueRow?.forecast).toBe(2200); // the frozen prediction is still shown even though the period hasn't completed
  });

  it("compares a completed past forecast against the real actual, computing variance and accuracy", async () => {
    const pastForecast = await prisma.financialForecast.create({
      data: {
        restaurantId, branchId: branchAId, periodType: "NEXT_MONTH", model: "HISTORICAL_TREND",
        targetStartDate: new Date(2026, 5, 1), targetEndDate: new Date(2026, 5, 30, 23, 59, 59, 999),
        predictions: {
          modelUsed: "HISTORICAL_TREND", granularity: "month", historicalPeriodsUsed: 2, overallConfidence: "medium", confidenceReasons: [],
          kpis: [{ key: "revenue", label: "Revenue", unit: "currency", higherIsBetter: true, predicted: 2000 }],
        },
      },
    });

    const comparison = await getForecastVsActualService(restaurantId, pastForecast.id);
    expect(comparison.isComplete).toBe(true);
    const revenueRow = comparison.rows.find((r) => r.key === "revenue");
    expect(revenueRow?.actual).toBe(1800); // real June revenue
    expect(revenueRow?.variance).toBe(-200);
    expect(revenueRow?.accuracyPercentage).toBeCloseTo(88.9, 1);
  });

  it("aggregates accuracy across every completed forecast for a scope", async () => {
    const report = await getForecastAccuracyReportService(restaurantId, branchAId);
    expect(report.completedForecastCount).toBe(1);
    const revenueAccuracy = report.kpiAccuracy.find((k) => k.key === "revenue");
    expect(revenueAccuracy?.averageAccuracyPercentage).toBeCloseTo(88.9, 1);
    expect(revenueAccuracy?.sampleSize).toBe(1);
  });

  it("ranks branches by expected revenue without creating extra persisted snapshots", async () => {
    const before = await listForecastSnapshotsService(restaurantId, { branchId: branchBId, periodType: "NEXT_MONTH" });
    const ranked = await rankBranchForecastsService(restaurantId, "NEXT_MONTH", "HISTORICAL_TREND");

    expect(ranked).toHaveLength(2);
    expect(ranked[0].branch.id).toBe(branchAId); // 9 bills/month rising beats Branch B's flat 3 bills/month
    expect(ranked[1].branch.id).toBe(branchBId);

    const after = await listForecastSnapshotsService(restaurantId, { branchId: branchBId, periodType: "NEXT_MONTH" });
    expect(after).toHaveLength(before.length); // ranking uses persist=false — viewing it must not silently accumulate snapshots
  });

  it("aggregates a restaurant-wide forecast (branchId null) across every branch", async () => {
    const result = await generateForecastService(restaurantId, null, "NEXT_MONTH", "HISTORICAL_TREND", undefined, false);
    const ordersRow = result.kpis.find((k) => k.key === "orders");
    // Branch A [5,7,9] + Branch B [3,3,3] summed per month = [8,10,12] -> slope 2, intercept 8 -> predicted 8+2*3=14
    expect(ordersRow?.predicted).toBe(14);
    expect(result.branchId).toBeNull();
  });
});
