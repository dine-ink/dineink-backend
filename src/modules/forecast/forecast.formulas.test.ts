import { describe, expect, it } from "vitest";
import {
  combineConfidence,
  computeConfidence,
  forecastMovingAverage,
  forecastSeasonal,
  forecastSeries,
  forecastTrend,
  linearRegression,
  resolveEffectiveModel,
} from "./forecast.formulas";
import { HistoricalPoint } from "./forecast.types";

const active = (value: number): HistoricalPoint => ({ value, hasActivity: value > 0 });

describe("linearRegression", () => {
  it("fits a perfect line exactly", () => {
    const { slope, intercept } = linearRegression([10, 20, 30, 40]); // y = 10 + 10x
    expect(slope).toBeCloseTo(10, 5);
    expect(intercept).toBeCloseTo(10, 5);
  });

  it("returns a flat line (slope 0) for a constant series", () => {
    const { slope, intercept } = linearRegression([50, 50, 50, 50]);
    expect(slope).toBeCloseTo(0, 5);
    expect(intercept).toBeCloseTo(50, 5);
  });

  it("handles fewer than 2 points without dividing by zero", () => {
    expect(linearRegression([])).toEqual({ slope: 0, intercept: 0 });
    expect(linearRegression([42])).toEqual({ slope: 0, intercept: 42 });
  });
});

describe("forecastTrend", () => {
  it("extrapolates a rising trend forward", () => {
    const result = forecastTrend([100, 110, 120, 130], 3);
    expect(result).toEqual([140, 150, 160]);
  });

  it("extrapolates a falling trend forward without going negative", () => {
    const result = forecastTrend([100, 50, 0], 3);
    // slope = -50/period; next values would be -50, -100, -150 — floored at 0
    expect(result.every((v) => v >= 0)).toBe(true);
  });

  it("holds a single data point flat", () => {
    expect(forecastTrend([200], 2)).toEqual([200, 200]);
  });

  it("returns zeros for an empty series", () => {
    expect(forecastTrend([], 3)).toEqual([0, 0, 0]);
  });
});

describe("forecastMovingAverage", () => {
  it("averages the last `window` periods and holds it flat across the horizon", () => {
    const result = forecastMovingAverage([100, 200, 300, 10000], 2, 3);
    // last 3 = [200, 300, 10000] -> avg = 3500
    expect(result).toEqual([3500, 3500]);
  });

  it("uses the whole series when it's shorter than the window", () => {
    const result = forecastMovingAverage([10, 20], 1, 3);
    expect(result).toEqual([15]);
  });

  it("returns zeros for an empty series", () => {
    expect(forecastMovingAverage([], 2)).toEqual([0, 0]);
  });
});

describe("forecastSeasonal", () => {
  it("returns null with fewer than 13 historical points", () => {
    expect(forecastSeasonal(Array(12).fill(100), 1)).toBeNull();
  });

  it("projects next year's same month scaled by the average YoY growth", () => {
    // 13 months: month 0 (a year-ago anchor for the 1 future period) = 100, month 12 (this year, same calendar month) = 110 -> 10% YoY growth
    const series = [100, ...Array(11).fill(105), 110];
    const result = forecastSeasonal(series, 1);
    expect(result).not.toBeNull();
    // anchorIndex = 13 + 0 - 12 = 1 -> series[1] = 105; scaled by the single YoY ratio 110/100 = 1.10
    expect(result![0]).toBeCloseTo(105 * 1.1, 5);
  });

  it("never predicts a negative value", () => {
    const series = Array(13).fill(0);
    const result = forecastSeasonal(series, 2);
    expect(result!.every((v) => v >= 0)).toBe(true);
  });
});

describe("computeConfidence", () => {
  it("returns 'low' with fewer than 3 data points, explaining why", () => {
    const result = computeConfidence([active(100), active(110)]);
    expect(result.level).toBe("low");
    expect(result.reasons[0]).toMatch(/insufficient history/i);
  });

  it("returns 'high' for a long, stable, gap-free series", () => {
    const points = [100, 102, 98, 101, 99, 103, 100].map(active);
    const result = computeConfidence(points);
    expect(result.level).toBe("high");
  });

  it("returns 'low' for a highly volatile series even with plenty of data points", () => {
    const points = [10, 1000, 5, 900, 20, 950, 8].map(active);
    const result = computeConfidence(points);
    expect(result.level).not.toBe("high");
    expect(result.reasons.some((r) => /volatile/i.test(r))).toBe(true);
  });

  it("flags missing (zero-activity) periods as a reason", () => {
    const points = [active(100), active(100), { value: 0, hasActivity: false }, active(100), active(100), active(100)];
    const result = computeConfidence(points);
    expect(result.reasons.some((r) => /no recorded activity/i.test(r))).toBe(true);
  });
});

describe("resolveEffectiveModel", () => {
  it("keeps Historical Trend when enough data exists", () => {
    expect(resolveEffectiveModel("HISTORICAL_TREND", "month", 5)).toEqual({ model: "HISTORICAL_TREND", downgradeReason: null });
  });

  it("downgrades Historical Trend to Moving Average with fewer than 2 points", () => {
    const result = resolveEffectiveModel("HISTORICAL_TREND", "month", 1);
    expect(result.model).toBe("MOVING_AVERAGE");
    expect(result.downgradeReason).toMatch(/falling back to moving average/i);
  });

  it("downgrades Seasonal to Historical Trend for weekly granularity regardless of data volume", () => {
    const result = resolveEffectiveModel("SEASONAL", "week", 52);
    expect(result.model).toBe("HISTORICAL_TREND");
    expect(result.downgradeReason).toMatch(/monthly history/i);
  });

  it("downgrades Seasonal to Historical Trend for monthly granularity with fewer than 13 points (but >= 2)", () => {
    const result = resolveEffectiveModel("SEASONAL", "month", 6);
    expect(result.model).toBe("HISTORICAL_TREND");
  });

  it("downgrades Seasonal all the way to Moving Average when fewer than 2 points exist", () => {
    const result = resolveEffectiveModel("SEASONAL", "month", 1);
    expect(result.model).toBe("MOVING_AVERAGE");
  });

  it("keeps Seasonal when monthly granularity has >= 13 points", () => {
    expect(resolveEffectiveModel("SEASONAL", "month", 13)).toEqual({ model: "SEASONAL", downgradeReason: null });
  });

  it("never downgrades Moving Average — it always has a defined result", () => {
    expect(resolveEffectiveModel("MOVING_AVERAGE", "month", 0)).toEqual({ model: "MOVING_AVERAGE", downgradeReason: null });
  });
});

describe("forecastSeries", () => {
  it("sums the per-period predictions into predictedTotal", () => {
    const points = [100, 110, 120, 130].map(active);
    const result = forecastSeries(points, "HISTORICAL_TREND", "month", 3);
    expect(result.perPeriod).toHaveLength(3);
    expect(result.predictedTotal).toBeCloseTo(result.perPeriod.reduce((s, v) => s + v, 0), 5);
    expect(result.modelUsed).toBe("HISTORICAL_TREND");
  });

  it("demotes a 'high' confidence to 'medium' when the requested model had to be downgraded", () => {
    // 20 stable monthly points but requesting SEASONAL on WEEKLY granularity forces a downgrade
    const points = Array(20).fill(0).map((_, i) => active(100 + i));
    const result = forecastSeries(points, "SEASONAL", "week", 1);
    expect(result.modelUsed).toBe("HISTORICAL_TREND");
    expect(result.confidence.level).not.toBe("high");
    expect(result.confidence.reasons[0]).toMatch(/monthly history/i);
  });
});

describe("combineConfidence", () => {
  it("takes the weakest level across all inputs", () => {
    const result = combineConfidence([
      { level: "high", reasons: ["ok"], dataPoints: 10 },
      { level: "low", reasons: ["volatile"], dataPoints: 3 },
      { level: "medium", reasons: ["limited"], dataPoints: 5 },
    ]);
    expect(result.level).toBe("low");
  });

  it("deduplicates reasons across inputs", () => {
    const result = combineConfidence([
      { level: "medium", reasons: ["same reason"], dataPoints: 5 },
      { level: "medium", reasons: ["same reason"], dataPoints: 5 },
    ]);
    expect(result.reasons).toEqual(["same reason"]);
  });

  it("defaults to 'high' when given no results at all", () => {
    expect(combineConfidence([]).level).toBe("high");
  });
});
