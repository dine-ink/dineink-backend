import { ScenarioOverrideField, ScenarioOverrides, SCENARIO_OVERRIDE_FIELDS } from "./scenario.types";

export class ValidationError extends Error {}

const VALID_TYPES = ["CONSERVATIVE", "EXPECTED", "OPTIMISTIC", "CUSTOM"];

// [min, max] per override field — growth deltas allow a wide negative range
// (a what-if tool must be able to model a bad quarter), percentages/targets
// stay within 0–100 (or a modest negative band for escalation-style rates,
// matching FinancialAssumptions' own bounds), absolute ₹ overrides just need
// to be non-negative.
const BOUNDS: Record<ScenarioOverrideField, [number, number]> = {
  revenueGrowthPercentage: [-100, 500],
  orderGrowthPercentage: [-100, 500],
  avgOrderValue: [0, 100_000],
  rent: [0, 10_000_000],
  utilities: [0, 10_000_000],
  marketing: [0, 10_000_000],
  maintenance: [0, 10_000_000],
  packaging: [0, 10_000_000],
  foodCostTargetPercentage: [0, 100],
  labourTargetPercentage: [0, 100],
  deliveryPercentage: [0, 100],
  swiggyCommissionPercentage: [0, 100],
  zomatoCommissionPercentage: [0, 100],
  royaltyPercentage: [0, 100],
  franchiseFeePercentage: [0, 100],
  salaryIncrementPercentage: [-50, 100],
  inflationPercentage: [-50, 100],
  rentEscalationPercentage: [-50, 100],
  workingDays: [0, 31],
  businessHours: [0, 24],
};

export const validateId = (value: unknown, label: string): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new ValidationError(`A valid ${label} is required`);
  return n;
};

export const validateOverrides = (body: any): ScenarioOverrides => {
  if (!body || typeof body !== "object") return {};
  const overrides: ScenarioOverrides = {};
  for (const field of SCENARIO_OVERRIDE_FIELDS) {
    if (!(field in body)) continue;
    const raw = body[field];
    if (raw === null) {
      overrides[field] = null; // explicit null = reset to inherited default
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new ValidationError(`'${field}' must be a number or null`);
    const [min, max] = BOUNDS[field];
    if (n < min || n > max) throw new ValidationError(`'${field}' must be between ${min} and ${max}`);
    overrides[field] = field === "workingDays" ? Math.round(n) : n;
  }
  return overrides;
};

export const validateCreateScenarioPayload = (body: any) => {
  if (!body || typeof body !== "object") throw new ValidationError("Request body is required");
  const { branchId, name, description, type } = body;

  if (typeof name !== "string" || !name.trim()) throw new ValidationError("'name' is required");
  const scenarioType = type && VALID_TYPES.includes(type) ? type : "CUSTOM";

  let parsedBranchId: number | null = null;
  if (branchId !== undefined && branchId !== null) parsedBranchId = validateId(branchId, "branchId");

  return {
    branchId: parsedBranchId,
    name: name.trim(),
    description: typeof description === "string" ? description : null,
    type: scenarioType as any,
    overrides: validateOverrides(body.overrides ?? body),
  };
};

export const validateUpdateScenarioPayload = (body: any) => {
  if (!body || typeof body !== "object") throw new ValidationError("Request body is required");
  const payload: { name?: string; description?: string | null; isActive?: boolean; overrides?: ScenarioOverrides } = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) throw new ValidationError("'name' must be a non-empty string");
    payload.name = body.name.trim();
  }
  if (body.description !== undefined) payload.description = typeof body.description === "string" ? body.description : null;
  if (body.isActive !== undefined) payload.isActive = !!body.isActive;
  if (body.overrides !== undefined) payload.overrides = validateOverrides(body.overrides);

  return payload;
};

export const validateResetFieldsPayload = (body: any): ScenarioOverrideField[] => {
  if (!body || !Array.isArray(body.fields)) throw new ValidationError("'fields' must be an array of override field names");
  return body.fields.map((f: any) => {
    if (!SCENARIO_OVERRIDE_FIELDS.includes(f)) throw new ValidationError(`Unknown override field '${f}'`);
    return f as ScenarioOverrideField;
  });
};
