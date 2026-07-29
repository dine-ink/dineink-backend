import { ASSUMPTION_FIELDS, AssumptionField, AssumptionUpdatePayload } from "./financeAssumptions.types";

export class ValidationError extends Error {}

// [min, max] per field. Escalation/inflation allow a modest negative range
// (deflation / a rent reduction clause is rare but not invalid); every other
// rate/target field is a plain 0–100 percentage or a positive physical
// quantity — nothing here should ever legitimately go outside these bounds.
const BOUNDS: Record<AssumptionField, [number, number]> = {
  rentPerSqFt: [0, 10000],
  camPerSqFt: [0, 10000],
  chargeableAreaSqFt: [0, 1_000_000],
  foodCostTargetPercentage: [0, 100],
  labourTargetPercentage: [0, 100],
  primeCostTargetPercentage: [0, 100],
  ebitdaTargetPercentage: [0, 100],
  occupancyTargetPercentage: [0, 100],
  utilityTargetPercentage: [0, 100],
  deliveryPercentage: [0, 100],
  swiggyCommissionPercentage: [0, 100],
  zomatoCommissionPercentage: [0, 100],
  franchiseFeePercentage: [0, 100],
  royaltyPercentage: [0, 100],
  marketingFeePercentage: [0, 100],
  salaryIncrementPercentage: [-50, 100],
  rentEscalationPercentage: [-50, 100],
  inflationPercentage: [-50, 100],
  gstPercentage: [0, 100],
  workingDays: [0, 31],
  businessHours: [0, 24],
};

/** Validates and normalizes an update payload — unknown keys are dropped, not just ignored silently by Prisma. */
export const validateAssumptionUpdatePayload = (body: any): AssumptionUpdatePayload => {
  if (!body || typeof body !== "object") {
    throw new ValidationError("Request body is required");
  }

  const payload: AssumptionUpdatePayload = {};
  for (const field of ASSUMPTION_FIELDS) {
    if (!(field in body)) continue;
    const raw = body[field];
    if (raw === null) {
      // Explicit null clears the field back to "inherit from default" (branch
      // override rows) or "unset" (restaurant default row).
      payload[field] = null;
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      throw new ValidationError(`'${field}' must be a number or null`);
    }
    const [min, max] = BOUNDS[field];
    if (n < min || n > max) {
      throw new ValidationError(`'${field}' must be between ${min} and ${max}`);
    }
    payload[field] = field === "workingDays" ? Math.round(n) : n;
  }

  return payload;
};

export const validateRestaurantId = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ValidationError("A valid restaurantId is required");
  }
  return n;
};

export const validateBranchId = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ValidationError("A valid branchId is required");
  }
  return n;
};
