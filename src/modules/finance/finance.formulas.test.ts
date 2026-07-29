import { describe, expect, it } from "vitest";
import {
  computeBreakEvenADS,
  computeBreakEvenOrders,
  computeBreakEvenRevenue,
  computeContributionMargin,
  computeContributionMarginPercentage,
  computeEBITDA,
  computeEBITDAPercentage,
  computeFinancialMetrics,
  computeFoodCostPercentage,
  computeGrossProfit,
  computeGrossProfitMarginPercentage,
  computeLabourCostPercentage,
  computeMarginOfSafety,
  computeMarginOfSafetyPercentage,
  computeNetProfit,
  computeNetProfitMarginPercentage,
  computeOvertimeCost,
  computePrimeCost,
  computePrimeCostPercentage,
  computeStandardShiftHours,
  computeTotalExpenses,
  computeVariance,
} from "./finance.formulas";

describe("finance.formulas — percentage helpers", () => {
  it("computeFoodCostPercentage divides food cost by revenue", () => {
    expect(computeFoodCostPercentage(200, 2000)).toBe(10);
  });

  it("computeFoodCostPercentage returns 0 when revenue is 0 (no division by zero)", () => {
    expect(computeFoodCostPercentage(200, 0)).toBe(0);
  });

  it("computeLabourCostPercentage rounds to one decimal", () => {
    expect(computeLabourCostPercentage(1000, 3000)).toBeCloseTo(33.3, 1);
  });
});

describe("finance.formulas — Prime Cost", () => {
  it("computePrimeCost is food cost + labour cost, not variable expenses", () => {
    expect(computePrimeCost(200, 1000)).toBe(1200);
  });

  it("computePrimeCostPercentage matches prime cost / revenue", () => {
    expect(computePrimeCostPercentage(1200, 2000)).toBe(60);
  });
});

describe("finance.formulas — Gross Profit", () => {
  it("computeGrossProfit is revenue minus food cost only (not labour/opex)", () => {
    expect(computeGrossProfit(2000, 200)).toBe(1800);
  });

  it("computeGrossProfitMarginPercentage matches gross profit / revenue", () => {
    expect(computeGrossProfitMarginPercentage(1800, 2000)).toBe(90);
  });
});

describe("finance.formulas — EBITDA (excludes finance cost and GST)", () => {
  it("computeEBITDA subtracts food, labour, fixed, and variable — not finance cost", () => {
    // revenue 2000, food 200, labour 1000, fixed 500, variable 100 -> 200
    expect(computeEBITDA(2000, 200, 1000, 500, 100)).toBe(200);
  });

  it("computeEBITDAPercentage matches ebitda / revenue", () => {
    expect(computeEBITDAPercentage(200, 2000)).toBe(10);
  });
});

describe("finance.formulas — Net Profit (EBITDA minus finance cost)", () => {
  it("computeNetProfit subtracts finance cost from EBITDA", () => {
    expect(computeNetProfit(200, 50)).toBe(150);
  });

  it("computeNetProfit equals EBITDA when finance cost is 0", () => {
    expect(computeNetProfit(300, 0)).toBe(300);
  });

  it("computeNetProfitMarginPercentage matches net profit / revenue", () => {
    expect(computeNetProfitMarginPercentage(150, 2000)).toBe(7.5);
  });
});

describe("finance.formulas — Contribution Margin", () => {
  it("computeContributionMargin subtracts food cost and variable expenses only (not labour/fixed)", () => {
    expect(computeContributionMargin(2000, 200, 100)).toBe(1700);
  });

  it("computeContributionMarginPercentage matches contribution margin / revenue", () => {
    expect(computeContributionMarginPercentage(1700, 2000)).toBe(85);
  });
});

describe("finance.formulas — Break-even", () => {
  it("computeBreakEvenRevenue divides fixed costs (fixed + labour + finance) by contribution margin %", () => {
    // fixed 500 + labour 1000 + finance 100 = 1600; CM% = 85 -> 1600 / 0.85 = 1882.35... rounds to 1882
    expect(computeBreakEvenRevenue(500, 1000, 100, 85)).toBe(1882);
  });

  it("computeBreakEvenRevenue returns null when contribution margin % is zero or negative", () => {
    expect(computeBreakEvenRevenue(500, 1000, 100, 0)).toBeNull();
    expect(computeBreakEvenRevenue(500, 1000, 100, -5)).toBeNull();
  });

  it("computeBreakEvenOrders ceils breakEvenRevenue / avgOrderValue", () => {
    expect(computeBreakEvenOrders(1882, 200)).toBe(10); // 9.41 -> 10
  });

  it("computeBreakEvenOrders returns null when breakEvenRevenue is null or AOV is 0", () => {
    expect(computeBreakEvenOrders(null, 200)).toBeNull();
    expect(computeBreakEvenOrders(1882, 0)).toBeNull();
  });

  it("computeBreakEvenADS divides breakEvenRevenue by days in period", () => {
    expect(computeBreakEvenADS(3100, 31)).toBeCloseTo(100, 5);
  });

  it("computeMarginOfSafety is actual revenue minus break-even revenue", () => {
    expect(computeMarginOfSafety(2000, 1882)).toBe(118);
  });

  it("computeMarginOfSafety returns null when break-even revenue is null (undefined contribution margin)", () => {
    expect(computeMarginOfSafety(2000, null)).toBeNull();
  });

  it("computeMarginOfSafetyPercentage matches margin of safety / actual revenue", () => {
    expect(computeMarginOfSafetyPercentage(118, 2000)).toBe(5.9);
  });
});

describe("finance.formulas — computeTotalExpenses", () => {
  it("sums food cost, labour, fixed, variable, finance cost, and GST", () => {
    expect(
      computeTotalExpenses({ foodCost: 200, labourCost: 1000, fixedExpenses: 500, variableExpenses: 100, financeCost: 50, gst: 0 }),
    ).toBe(1850);
  });
});

describe("finance.formulas — computeFinancialMetrics (the full aggregate)", () => {
  // A hand-computed scenario, matching the real numbers verified live against
  // the database during Tier-1 correctness verification: 10 bills x ₹200 =
  // ₹2000 revenue, food cost ₹200 (10 dishes x ₹20 recipe cost), labour
  // ₹1000, fixed expenses ₹500, no variable expenses, no finance cost.
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

  it("computes foodCostPercentage", () => expect(metrics.foodCostPercentage).toBe(10));
  it("computes primeCost as food + labour", () => expect(metrics.primeCost).toBe(1200));
  it("computes primeCostPercentage", () => expect(metrics.primeCostPercentage).toBe(60));
  it("computes grossProfit as revenue - food cost", () => expect(metrics.grossProfit).toBe(1800));
  it("computes ebitda excluding finance cost", () => expect(metrics.ebitda).toBe(300));
  it("computes ebitdaPercentage", () => expect(metrics.ebitdaPercentage).toBe(15));
  it("computes netProfit equal to ebitda when finance cost is 0", () => expect(metrics.netProfit).toBe(300));
  it("computes contributionMargin excluding labour/fixed", () => expect(metrics.contributionMargin).toBe(1800));
  it("computes breakEvenRevenue from fixed costs and contribution margin %", () => {
    // fixed 500 + labour 1000 + finance 0 = 1500; CM% = 90 -> 1500/0.9 = 1666.67 -> 1667
    expect(metrics.breakEvenRevenue).toBe(1667);
  });
  it("computes breakEvenOrders from breakEvenRevenue / AOV", () => {
    expect(metrics.breakEvenOrders).toBe(Math.ceil(1667 / 200));
  });
});

describe("finance.formulas — computeVariance", () => {
  it("computes a positive variance and 'up' trend when current > previous", () => {
    const v = computeVariance(2000, 1000);
    expect(v.variance).toBe(1000);
    expect(v.variancePercentage).toBe(100);
    expect(v.trendDirection).toBe("up");
  });

  it("computes a negative variance and 'down' trend when current < previous", () => {
    const v = computeVariance(500, 1000);
    expect(v.variance).toBe(-500);
    expect(v.variancePercentage).toBe(-50);
    expect(v.trendDirection).toBe("down");
  });

  it("computes 'flat' trend when current equals previous", () => {
    const v = computeVariance(1000, 1000);
    expect(v.variance).toBe(0);
    expect(v.trendDirection).toBe("flat");
  });

  it("returns nulls when either value is null (e.g. no prior-period data)", () => {
    const v = computeVariance(1000, null);
    expect(v.variance).toBeNull();
    expect(v.variancePercentage).toBeNull();
    expect(v.trendDirection).toBeNull();
    expect(v.value).toBe(1000);
    expect(v.previousValue).toBeNull();
  });

  it("returns null variancePercentage (not Infinity/NaN) when previous is exactly 0", () => {
    const v = computeVariance(500, 0);
    expect(v.variance).toBe(500);
    expect(v.variancePercentage).toBeNull();
  });
});

describe("finance.formulas — overtime pay (shared by the Finance Engine and Attendance/Productivity)", () => {
  const policy = { morningShiftHours: 6, eveningShiftHours: 6, fullDayShiftHours: 10 };

  it("computeStandardShiftHours resolves MORNING/EVENING shifts and falls back to the full-day length otherwise", () => {
    expect(computeStandardShiftHours("MORNING", policy)).toBe(6);
    expect(computeStandardShiftHours("EVENING", policy)).toBe(6);
    expect(computeStandardShiftHours("FULL_DAY", policy)).toBe(10);
    expect(computeStandardShiftHours(null, policy)).toBe(10);
  });

  it("computeStandardShiftHours falls back to sensible defaults when a policy field is unset", () => {
    expect(computeStandardShiftHours("MORNING", { morningShiftHours: 0, eveningShiftHours: 6, fullDayShiftHours: 10 })).toBe(6);
  });

  it("computeOvertimeCost derives an hourly rate from monthly salary and standard hours, times the multiplier", () => {
    // hourlyRate = 15000 / (30 * 10) = 50; overtimeCost = 5 * 50 * 1.5 = 375
    expect(computeOvertimeCost(15000, 10, 5, 1.5)).toBe(375);
  });

  it("computeOvertimeCost returns 0 when there are no overtime hours or standard hours is 0", () => {
    expect(computeOvertimeCost(15000, 10, 0, 1.5)).toBe(0);
    expect(computeOvertimeCost(15000, 0, 5, 1.5)).toBe(0);
  });
});
