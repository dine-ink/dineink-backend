import { describe, expect, it } from "vitest";
import {
  computeAnnualCashFlows,
  computeAnnualizedROI,
  computeCumulativeCashFlows,
  computeDiscountedCashFlows,
  computeDiscountedPaybackPeriod,
  computeInvestmentMetrics,
  computeIRR,
  computeNPV,
  computePaybackPeriod,
  computeProfitabilityIndex,
  computeROI,
} from "./investment.formulas";
import { InvestmentAssumptions } from "./investment.types";

const baseAssumptions: InvestmentAssumptions = {
  initialInvestment: 1000,
  projectLifeYears: 3,
  discountRate: 10,
  inflationRate: 0,
  monthlyRevenueIncrease: 0,
  revenueGrowthPercentage: 0,
  expectedCostSavings: 0,
  labourSavings: 0,
  additionalOperatingExpenses: 0,
  maintenanceCost: 0,
  salvageValue: 0,
};

describe("computeAnnualCashFlows", () => {
  it("compounds the revenue increase at revenueGrowthPercentage year over year", () => {
    const cashFlows = computeAnnualCashFlows({ ...baseAssumptions, projectLifeYears: 3, monthlyRevenueIncrease: 1000, revenueGrowthPercentage: 10 });
    // year1: 1000*12*1.1^0=12000; year2: *1.1^1=13200; year3: *1.1^2=14520
    expect(cashFlows).toEqual([12000, 13200, 14520]);
  });

  it("escalates cost savings and additional opex at inflationRate, not revenueGrowthPercentage", () => {
    const cashFlows = computeAnnualCashFlows({
      ...baseAssumptions, projectLifeYears: 2, expectedCostSavings: 500, labourSavings: 500, additionalOperatingExpenses: 200, inflationRate: 10,
    });
    // year1: (500+500)*12 - 200*12 = 12000-2400=9600; year2: same figures *1.1 each = 13200-2640=10560
    expect(cashFlows).toEqual([9600, 10560]);
  });

  it("adds salvage value only in the final year", () => {
    const cashFlows = computeAnnualCashFlows({ ...baseAssumptions, projectLifeYears: 2, salvageValue: 5000 });
    expect(cashFlows).toEqual([0, 5000]);
  });

  it("subtracts annual maintenance cost (not multiplied by 12 — already an annual figure)", () => {
    const cashFlows = computeAnnualCashFlows({ ...baseAssumptions, projectLifeYears: 1, maintenanceCost: 3000 });
    expect(cashFlows).toEqual([-3000]);
  });
});

describe("computeCumulativeCashFlows", () => {
  it("starts at -initialInvestment and accumulates each year", () => {
    expect(computeCumulativeCashFlows(1000, [400, 400, 400])).toEqual([-1000, -600, -200, 200]);
  });
});

describe("computePaybackPeriod", () => {
  it("interpolates the fractional year within which cumulative cash flow crosses zero", () => {
    // -1000, -600, -200, +200 -> crosses zero partway through year 3: needs 200 of that year's 400 -> 0.5
    expect(computePaybackPeriod(1000, [400, 400, 400])).toBe(2.5);
  });

  it("returns exactly a whole year when cash flow lands exactly on zero", () => {
    expect(computePaybackPeriod(1000, [500, 500])).toBe(2);
  });

  it("returns null when the investment never pays back within the project life", () => {
    expect(computePaybackPeriod(1000, [100, 100, 100])).toBeNull();
  });
});

describe("computeDiscountedCashFlows / computeNPV", () => {
  it("discounts a single-period cash flow exactly (1100 at 10% = 1000)", () => {
    const discounted = computeDiscountedCashFlows(1000, [1100], 10);
    expect(discounted).toEqual([-1000, 1000]);
    expect(computeNPV(discounted)).toBe(0);
  });

  it("reduces to a plain sum when discountRate is 0", () => {
    const discounted = computeDiscountedCashFlows(1000, [600, 600, 600], 0);
    expect(computeNPV(discounted)).toBe(800); // -1000 + 600*3
  });

  it("produces a positive NPV when discounted inflows exceed the initial investment", () => {
    const discounted = computeDiscountedCashFlows(1000, [1331], 0); // no discounting needed to see this is > 1000
    expect(computeNPV(discounted)).toBe(331);
  });
});

describe("computeDiscountedPaybackPeriod", () => {
  it("takes longer than the undiscounted payback period for the same cash flows", () => {
    // 4 years of 500 on a 1000 initial investment pays back in exactly 2 years undiscounted;
    // discounting those same later cash flows must push the break-even point out further, not earlier.
    const discounted = computeDiscountedCashFlows(1000, [500, 500, 500, 500], 10);
    const discountedPayback = computeDiscountedPaybackPeriod(discounted);
    const undiscountedPayback = computePaybackPeriod(1000, [500, 500, 500, 500]);
    expect(undiscountedPayback).toBe(2);
    expect(discountedPayback).not.toBeNull();
    expect(discountedPayback!).toBeGreaterThan(undiscountedPayback!);
  });

  it("returns null if discounted cash flows never recover the initial investment", () => {
    const discounted = computeDiscountedCashFlows(1000, [100, 100, 100], 10);
    expect(computeDiscountedPaybackPeriod(discounted)).toBeNull();
  });
});

describe("computeIRR", () => {
  it("solves a single-period cash flow exactly (1100 on 1000 = 10%)", () => {
    expect(computeIRR([-1000, 1100])).toBeCloseTo(10, 1);
  });

  it("solves a 3-year single-final-payment stream exactly (1000 * 1.1^3 = 1331 -> 10%)", () => {
    expect(computeIRR([-1000, 0, 0, 1331])).toBeCloseTo(10, 1);
  });

  it("solves a multi-year even cash flow stream to a plausible, self-consistent rate", () => {
    const irr = computeIRR([-1000, 400, 400, 400]);
    expect(irr).not.toBeNull();
    // The IRR found must itself zero out the NPV of these exact cash flows — the real test of correctness.
    const rate = irr! / 100;
    const npvAtIrr = [-1000, 400, 400, 400].reduce((sum, cf, t) => sum + cf / Math.pow(1 + rate, t), 0);
    expect(npvAtIrr).toBeCloseTo(0, 0);
  });

  it("returns null when every cash flow is negative (no viable return exists)", () => {
    expect(computeIRR([-1000, -100, -100])).toBeNull();
  });

  it("returns null when every cash flow is positive (no capital was ever at risk)", () => {
    expect(computeIRR([1000, 100, 100])).toBeNull();
  });
});

describe("computeProfitabilityIndex", () => {
  it("computes (NPV + initial investment) / initial investment", () => {
    expect(computeProfitabilityIndex(200, 1000)).toBeCloseTo(1.2, 3);
  });

  it("returns null for a zero or negative initial investment", () => {
    expect(computeProfitabilityIndex(200, 0)).toBeNull();
  });
});

describe("computeROI / computeAnnualizedROI", () => {
  it("computes total ROI over the project life", () => {
    expect(computeROI([400, 400, 400], 1000)).toBeCloseTo(20, 5); // (1200-1000)/1000*100
  });

  it("annualizes ROI by dividing by project life years", () => {
    expect(computeAnnualizedROI(20, 3)).toBeCloseTo(6.7, 1);
  });

  it("returns null ROI for a zero or negative initial investment", () => {
    expect(computeROI([400], 0)).toBeNull();
  });
});

describe("computeInvestmentMetrics — full integration of the pure formulas", () => {
  it("produces internally consistent metrics for a textbook cash flow stream", () => {
    const metrics = computeInvestmentMetrics({ ...baseAssumptions, monthlyRevenueIncrease: 100, revenueGrowthPercentage: 0, projectLifeYears: 3, discountRate: 10 });
    // monthlyRevenueIncrease 100 * 12 = 1200/year flat (no growth) -> annualCashFlows = [1200,1200,1200]
    expect(metrics.projection.annualCashFlows).toEqual([1200, 1200, 1200]);
    expect(metrics.roiPercentage).toBeCloseTo(260, 5); // (3600-1000)/1000*100
    expect(metrics.paybackPeriodYears).toBeCloseTo(0.83, 1); // 1000/1200
    expect(metrics.npv).toBeGreaterThan(0); // a clearly profitable, quick-payback project should have positive NPV
    expect(metrics.irrPercentage).not.toBeNull();
    expect(metrics.irrPercentage!).toBeGreaterThan(baseAssumptions.discountRate); // IRR must exceed the discount rate whenever NPV is positive — the two metrics must agree
    expect(metrics.profitabilityIndex).not.toBeNull();
    expect(metrics.profitabilityIndex!).toBeGreaterThan(1); // PI > 1 whenever NPV > 0 — must also agree
  });
});
