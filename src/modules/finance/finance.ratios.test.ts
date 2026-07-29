import { describe, expect, it } from "vitest";
import { computeAchievement } from "./finance.ratios";

describe("computeAchievement — direction-aware target achievement %", () => {
  it("for higherIsBetter KPIs (e.g. Revenue), achievement = value / target", () => {
    // ₹2000 revenue against a ₹4000 target = 50% achievement
    expect(computeAchievement(2000, 4000, true)).toBe(50);
  });

  it("for higherIsBetter KPIs, beating the target reads > 100%", () => {
    expect(computeAchievement(5000, 4000, true)).toBe(125);
  });

  it("for cost-type KPIs (higherIsBetter=false), achievement = target / value — beating a lower target reads >= 100%", () => {
    // Food Cost % actual 10%, target 25% — the owner is well under target,
    // which should read as a GOOD result (>=100%), not a bad one.
    expect(computeAchievement(10, 25, false)).toBe(250);
  });

  it("for cost-type KPIs, running over the target reads < 100%", () => {
    // Actual food cost 30% against a 25% target — over budget, should read < 100%.
    expect(computeAchievement(30, 25, false)).toBe(83.3);
  });

  it("returns null when value is null (period hasn't loaded/computed)", () => {
    expect(computeAchievement(null, 25, false)).toBeNull();
  });

  it("returns null when no target is configured", () => {
    expect(computeAchievement(2000, null, true)).toBeNull();
  });

  it("returns null when target is exactly 0 (avoids division by zero)", () => {
    expect(computeAchievement(2000, 0, true)).toBeNull();
    expect(computeAchievement(10, 0, false)).toBeNull();
  });
});
