import { describe, expect, it } from "vitest";
import { resolveDateRange } from "../../utils/dateRange";
import { aggregateBudgetForCategory, statusFor } from "./budget.service";

describe("aggregateBudgetForCategory — currency/count categories (summed, prorated by day overlap)", () => {
  it("sums a single whole month exactly when the range is that whole month", () => {
    const items = [{ category: "revenue", year: 2026, month: 7, amount: 3100 }];
    const range = resolveDateRange("custom", "2026-07-01", "2026-07-31");
    expect(aggregateBudgetForCategory(items, "revenue", range, "currency")).toBe(3100);
  });

  it("sums across 3 whole months (a quarter) exactly", () => {
    const items = [
      { category: "revenue", year: 2026, month: 4, amount: 1000 },
      { category: "revenue", year: 2026, month: 5, amount: 1000 },
      { category: "revenue", year: 2026, month: 6, amount: 1000 },
    ];
    const range = resolveDateRange("custom", "2026-04-01", "2026-06-30");
    expect(aggregateBudgetForCategory(items, "revenue", range, "currency")).toBe(3000);
  });

  it("prorates a partial-month custom range instead of counting the whole month's budget", () => {
    // July has 31 days; a 2026-07-16..07-31 range covers 16 of them.
    const items = [{ category: "revenue", year: 2026, month: 7, amount: 3100 }];
    const range = resolveDateRange("custom", "2026-07-16", "2026-07-31");
    // 3100 * (16/31) = 1600
    expect(aggregateBudgetForCategory(items, "revenue", range, "currency")).toBe(1600);
  });

  it("ignores months with no budget item for that category and months outside the range", () => {
    const items = [
      { category: "revenue", year: 2026, month: 7, amount: 1000 },
      { category: "revenue", year: 2026, month: 8, amount: 2000 }, // outside range
      { category: "foodCost", year: 2026, month: 7, amount: 500 }, // different category
    ];
    const range = resolveDateRange("custom", "2026-07-01", "2026-07-31");
    expect(aggregateBudgetForCategory(items, "revenue", range, "currency")).toBe(1000);
  });

  it("returns null (not 0) when no matching budget item overlaps the range at all", () => {
    const items = [{ category: "revenue", year: 2026, month: 1, amount: 1000 }];
    const range = resolveDateRange("custom", "2026-07-01", "2026-07-31");
    expect(aggregateBudgetForCategory(items, "revenue", range, "currency")).toBeNull();
  });

  it("counts (Orders) are summed the same way as currency", () => {
    const items = [
      { category: "orders", year: 2026, month: 4, amount: 100 },
      { category: "orders", year: 2026, month: 5, amount: 150 },
    ];
    const range = resolveDateRange("custom", "2026-04-01", "2026-05-31");
    expect(aggregateBudgetForCategory(items, "orders", range, "count")).toBe(250);
  });
});

describe("aggregateBudgetForCategory — percentage categories (day-weighted average, not summed)", () => {
  it("averages a single month's percentage unchanged", () => {
    const items = [{ category: "foodCostPercentage", year: 2026, month: 7, amount: 28 }];
    const range = resolveDateRange("custom", "2026-07-01", "2026-07-31");
    expect(aggregateBudgetForCategory(items, "foodCostPercentage", range, "percentage")).toBe(28);
  });

  it("averages 2 equal-length months evenly (not summed to 56)", () => {
    const items = [
      { category: "foodCostPercentage", year: 2026, month: 4, amount: 30 }, // April, 30 days
      { category: "foodCostPercentage", year: 2026, month: 5, amount: 26 }, // May, 31 days — close enough to test near-even weighting
    ];
    const range = resolveDateRange("custom", "2026-04-01", "2026-05-31");
    const result = aggregateBudgetForCategory(items, "foodCostPercentage", range, "percentage");
    // Day-weighted: (30*30 + 26*31) / 61 = (900 + 806) / 61 = 27.98... -> 28.0
    expect(result).toBeCloseTo(28.0, 1);
  });

  it("weights a partial month's percentage by its actual day-overlap, not full-month days", () => {
    // Range ends mid-July, so July should only contribute 16 of its 31 days.
    const items = [
      { category: "foodCostPercentage", year: 2026, month: 6, amount: 20 }, // full June, 30 days
      { category: "foodCostPercentage", year: 2026, month: 7, amount: 40 }, // only July 1-16 = 16 days
    ];
    const range = resolveDateRange("custom", "2026-06-01", "2026-07-16");
    const result = aggregateBudgetForCategory(items, "foodCostPercentage", range, "percentage");
    // (20*30 + 40*16) / (30+16) = (600 + 640) / 46 = 26.96 -> 27.0
    expect(result).toBeCloseTo(27.0, 1);
  });
});

describe("statusFor — budget achievement thresholds", () => {
  it("returns 'no-data' when achievement % is null (no budget set or no actual available)", () => {
    expect(statusFor(null)).toBe("no-data");
  });

  it("returns 'on-track' at or above 100% achievement", () => {
    expect(statusFor(100)).toBe("on-track");
    expect(statusFor(150)).toBe("on-track");
  });

  it("returns 'warning' between 90% (inclusive) and 100% (exclusive)", () => {
    expect(statusFor(90)).toBe("warning");
    expect(statusFor(99.9)).toBe("warning");
  });

  it("returns 'critical' below 90%", () => {
    expect(statusFor(89.9)).toBe("critical");
    expect(statusFor(0)).toBe("critical");
    expect(statusFor(-50)).toBe("critical");
  });
});
