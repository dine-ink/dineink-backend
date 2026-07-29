import { describe, expect, it } from "vitest";
import { validateBranchIdParam, validateId, validatePercentage, ValidationError, VALID_PERIODS } from "./ai.validation";

describe("ai.validation", () => {
  it("validateId accepts a positive numeric string and rejects everything else", () => {
    expect(validateId("12", "restaurantId")).toBe(12);
    expect(() => validateId("0", "restaurantId")).toThrow(ValidationError);
    expect(() => validateId("abc", "restaurantId")).toThrow(ValidationError);
    expect(() => validateId(undefined, "restaurantId")).toThrow(ValidationError);
  });

  it("validateBranchIdParam distinguishes 'unset' (undefined), 'restaurant-wide' (null), and a real branch id", () => {
    expect(validateBranchIdParam(undefined)).toBeUndefined();
    expect(validateBranchIdParam("null")).toBeNull();
    expect(validateBranchIdParam("")).toBeNull();
    expect(validateBranchIdParam("7")).toBe(7);
    expect(() => validateBranchIdParam("-1")).toThrow(ValidationError);
  });

  it("validatePercentage accepts any finite number, including negative (a sales decline scenario)", () => {
    expect(validatePercentage("10")).toBe(10);
    expect(validatePercentage("-5")).toBe(-5);
    expect(() => validatePercentage("not-a-number")).toThrow(ValidationError);
  });

  it("exposes the same period vocabulary as the Executive Dashboard", () => {
    expect(VALID_PERIODS).toContain("currentMonth");
    expect(VALID_PERIODS).toContain("currentQuarter");
  });
});
