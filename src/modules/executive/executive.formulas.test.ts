import { describe, expect, it } from "vitest";
import { clampScore, computeBusinessHealthScore, statusForScore } from "./executive.formulas";

describe("clampScore", () => {
  it("passes null through unchanged", () => {
    expect(clampScore(null)).toBeNull();
  });

  it("clamps a value above 100 down to 100", () => {
    expect(clampScore(150)).toBe(100);
  });

  it("clamps a negative value up to 0", () => {
    expect(clampScore(-20)).toBe(0);
  });

  it("leaves an in-range value untouched", () => {
    expect(clampScore(72)).toBe(72);
  });
});

describe("statusForScore", () => {
  it("returns 'no-data' for null", () => {
    expect(statusForScore(null)).toBe("no-data");
  });

  it("returns 'excellent' at and above 85", () => {
    expect(statusForScore(85)).toBe("excellent");
    expect(statusForScore(100)).toBe("excellent");
  });

  it("returns 'good' between 70 (inclusive) and 85", () => {
    expect(statusForScore(70)).toBe("good");
    expect(statusForScore(84.9)).toBe("good");
  });

  it("returns 'warning' between 50 (inclusive) and 70", () => {
    expect(statusForScore(50)).toBe("warning");
    expect(statusForScore(69.9)).toBe("warning");
  });

  it("returns 'critical' below 50", () => {
    expect(statusForScore(49.9)).toBe("critical");
    expect(statusForScore(0)).toBe("critical");
  });
});

describe("computeBusinessHealthScore", () => {
  it("computes a plain weighted average when every category has data", () => {
    const result = computeBusinessHealthScore([
      { key: "a", label: "A", score: 100, weight: 0.5 },
      { key: "b", label: "B", score: 50, weight: 0.5 },
    ]);
    expect(result.overall).toBe(75); // 100*0.5 + 50*0.5
    expect(result.status).toBe("good");
  });

  it("redistributes a missing category's weight instead of treating it as a 0", () => {
    const result = computeBusinessHealthScore([
      { key: "a", label: "A", score: 100, weight: 0.5 },
      { key: "b", label: "B", score: null, weight: 0.5 },
    ]);
    // If null were treated as 0, overall would be 50 — redistribution must give 100 instead (only "a" is measurable).
    expect(result.overall).toBe(100);
    expect(result.categories.find((c) => c.key === "b")!.status).toBe("no-data");
    expect(result.categories.find((c) => c.key === "b")!.contribution).toBe(0);
  });

  it("falls back to 0 / critical only when literally every category is unmeasurable", () => {
    const result = computeBusinessHealthScore([{ key: "a", label: "A", score: null, weight: 1 }]);
    expect(result.overall).toBe(0);
    expect(result.status).toBe("critical");
  });

  it("clamps an above-100 achievement score before weighting, so beating a target doesn't inflate the overall score past 100", () => {
    const result = computeBusinessHealthScore([{ key: "a", label: "A", score: 150, weight: 1 }]);
    expect(result.overall).toBe(100);
  });

  it("generates suggestions only for categories scoring below 70, worst first, capped at 5", () => {
    const categories = ["a", "b", "c", "d", "e", "f"].map((key, i) => ({
      key, label: key.toUpperCase(), score: 60 - i * 5, weight: 1 / 6, // 60,55,50,45,40,35 — all below 70
    }));
    const result = computeBusinessHealthScore(categories);
    expect(result.suggestions).toHaveLength(5);
  });

  it("does not suggest anything for a category scoring at or above 70", () => {
    const result = computeBusinessHealthScore([{ key: "a", label: "A", score: 90, weight: 1 }]);
    expect(result.suggestions).toHaveLength(0);
  });
});
