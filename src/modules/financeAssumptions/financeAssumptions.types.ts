// Every configurable rate/target field on FinancialAssumptions. Shared by
// validation (what's a legal value) and the service's field-by-field merge
// (branch override wins over restaurant default when non-null) — one list,
// used everywhere, so a field added here is automatically validated and
// merged without touching either of those in a second place.
export const ASSUMPTION_FIELDS = [
  "rentPerSqFt",
  "camPerSqFt",
  "chargeableAreaSqFt",
  "foodCostTargetPercentage",
  "labourTargetPercentage",
  "primeCostTargetPercentage",
  "ebitdaTargetPercentage",
  "occupancyTargetPercentage",
  "utilityTargetPercentage",
  "deliveryPercentage",
  "swiggyCommissionPercentage",
  "zomatoCommissionPercentage",
  "franchiseFeePercentage",
  "royaltyPercentage",
  "marketingFeePercentage",
  "salaryIncrementPercentage",
  "rentEscalationPercentage",
  "inflationPercentage",
  "gstPercentage",
  "workingDays",
  "businessHours",
] as const;

export type AssumptionField = (typeof ASSUMPTION_FIELDS)[number];

export type AssumptionValues = Record<AssumptionField, number | null>;

/** Payload accepted by the update endpoints — every field optional. */
export type AssumptionUpdatePayload = Partial<Record<AssumptionField, number | null>>;

/** A resolved (restaurant-default + branch-override merged) set of assumptions. */
export interface ResolvedAssumptions extends AssumptionValues {
  restaurantId: number;
  branchId: number;
  /** Which fields came from the branch's own override row rather than the restaurant default. */
  overriddenFields: AssumptionField[];
}
