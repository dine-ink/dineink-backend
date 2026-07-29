import { describe, expect, it } from "vitest";
import {
  ValidationError,
  validateCreateScenarioPayload,
  validateId,
  validateOverrides,
  validateResetFieldsPayload,
  validateUpdateScenarioPayload,
} from "./scenario.validation";

describe("validateOverrides", () => {
  it("returns an empty object when no override fields are present", () => {
    expect(validateOverrides({ name: "irrelevant" })).toEqual({});
  });

  it("passes through valid numeric values within bounds", () => {
    expect(validateOverrides({ revenueGrowthPercentage: 10, rent: 20000 })).toEqual({
      revenueGrowthPercentage: 10,
      rent: 20000,
    });
  });

  it("treats an explicit null as 'reset to inherited default', not an error", () => {
    expect(validateOverrides({ rent: null })).toEqual({ rent: null });
  });

  it("rounds workingDays to the nearest whole day", () => {
    expect(validateOverrides({ workingDays: 25.6 })).toEqual({ workingDays: 26 });
  });

  it("rejects a non-numeric value", () => {
    expect(() => validateOverrides({ rent: "not-a-number" })).toThrow(ValidationError);
  });

  it("rejects a percentage field above its upper bound", () => {
    expect(() => validateOverrides({ foodCostTargetPercentage: 150 })).toThrow(ValidationError);
  });

  it("rejects a growth percentage below its lower bound", () => {
    expect(() => validateOverrides({ revenueGrowthPercentage: -150 })).toThrow(ValidationError);
  });

  it("allows a negative growth percentage within bounds (a Conservative-style scenario)", () => {
    expect(validateOverrides({ revenueGrowthPercentage: -100 })).toEqual({ revenueGrowthPercentage: -100 });
  });

  it("rejects businessHours above 24", () => {
    expect(() => validateOverrides({ businessHours: 25 })).toThrow(ValidationError);
  });

  it("ignores fields that aren't recognized override fields", () => {
    expect(validateOverrides({ notAnOverrideField: 999 })).toEqual({});
  });
});

describe("validateCreateScenarioPayload", () => {
  it("requires a non-empty name", () => {
    expect(() => validateCreateScenarioPayload({})).toThrow(ValidationError);
    expect(() => validateCreateScenarioPayload({ name: "   " })).toThrow(ValidationError);
  });

  it("defaults type to CUSTOM when omitted or invalid", () => {
    expect(validateCreateScenarioPayload({ name: "Test" }).type).toBe("CUSTOM");
    expect(validateCreateScenarioPayload({ name: "Test", type: "NOT_REAL" }).type).toBe("CUSTOM");
  });

  it("accepts an explicit built-in type", () => {
    expect(validateCreateScenarioPayload({ name: "Test", type: "OPTIMISTIC" }).type).toBe("OPTIMISTIC");
  });

  it("defaults branchId to null (restaurant-wide) when omitted", () => {
    expect(validateCreateScenarioPayload({ name: "Test" }).branchId).toBeNull();
  });

  it("parses a provided branchId", () => {
    expect(validateCreateScenarioPayload({ name: "Test", branchId: 5 }).branchId).toBe(5);
  });

  it("rejects an invalid branchId", () => {
    expect(() => validateCreateScenarioPayload({ name: "Test", branchId: -1 })).toThrow(ValidationError);
  });

  it("reads overrides from a nested 'overrides' object when present", () => {
    const payload = validateCreateScenarioPayload({ name: "Test", overrides: { rent: 20000 } });
    expect(payload.overrides).toEqual({ rent: 20000 });
  });

  it("falls back to reading override fields directly off the body when 'overrides' is absent", () => {
    const payload = validateCreateScenarioPayload({ name: "Test", rent: 20000 });
    expect(payload.overrides).toEqual({ rent: 20000 });
  });
});

describe("validateUpdateScenarioPayload", () => {
  it("only includes fields explicitly present in the body", () => {
    expect(validateUpdateScenarioPayload({ name: "New Name" })).toEqual({ name: "New Name" });
  });

  it("rejects an empty-string name", () => {
    expect(() => validateUpdateScenarioPayload({ name: "  " })).toThrow(ValidationError);
  });

  it("coerces isActive to a boolean", () => {
    expect(validateUpdateScenarioPayload({ isActive: 1 })).toEqual({ isActive: true });
  });

  it("validates nested overrides the same way as create", () => {
    expect(() => validateUpdateScenarioPayload({ overrides: { foodCostTargetPercentage: 500 } })).toThrow(ValidationError);
  });
});

describe("validateResetFieldsPayload", () => {
  it("requires 'fields' to be an array", () => {
    expect(() => validateResetFieldsPayload({})).toThrow(ValidationError);
    expect(() => validateResetFieldsPayload({ fields: "rent" })).toThrow(ValidationError);
  });

  it("passes through a list of valid override field names", () => {
    expect(validateResetFieldsPayload({ fields: ["rent", "foodCostTargetPercentage"] })).toEqual([
      "rent",
      "foodCostTargetPercentage",
    ]);
  });

  it("rejects an unknown field name", () => {
    expect(() => validateResetFieldsPayload({ fields: ["notARealField"] })).toThrow(ValidationError);
  });
});

describe("validateId", () => {
  it("accepts a positive numeric string", () => {
    expect(validateId("42", "scenarioId")).toBe(42);
  });

  it("rejects zero, negative, and non-numeric values", () => {
    expect(() => validateId("0", "scenarioId")).toThrow(ValidationError);
    expect(() => validateId("-1", "scenarioId")).toThrow(ValidationError);
    expect(() => validateId("abc", "scenarioId")).toThrow(ValidationError);
  });
});
