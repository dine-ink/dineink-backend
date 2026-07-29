import { InvestmentStatusValue, InvestmentTypeValue } from "./investment.types";

export class ValidationError extends Error {}

const VALID_TYPES: InvestmentTypeValue[] = [
  "NEW_BRANCH", "BRANCH_EXPANSION", "KITCHEN_UPGRADE", "EQUIPMENT_PURCHASE",
  "INTERIOR_RENOVATION", "DELIVERY_EXPANSION", "MARKETING_INVESTMENT", "FRANCHISE_OUTLET", "CUSTOM",
];
const VALID_STATUSES: InvestmentStatusValue[] = ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

// [min, max] — generous, numeric-sanity bounds only (not business-rule sign
// forcing); matches the level of strictness already established for
// Scenario's override fields.
const BOUNDS: Record<string, [number, number]> = {
  projectLifeYears: [1, 50],
  discountRate: [-50, 100],
  inflationRate: [-50, 100],
  revenueGrowthPercentage: [-100, 500],
  monthlyRevenueIncrease: [-10_000_000, 10_000_000],
  expectedCostSavings: [-10_000_000, 10_000_000],
  labourSavings: [-10_000_000, 10_000_000],
  additionalOperatingExpenses: [-10_000_000, 10_000_000],
  maintenanceCost: [-10_000_000, 10_000_000],
  salvageValue: [-10_000_000, 10_000_000],
};

const ASSUMPTION_FIELDS = Object.keys(BOUNDS).filter((f) => f !== "projectLifeYears");

export const validateId = (value: unknown, label: string): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new ValidationError(`A valid ${label} is required`);
  return n;
};

const validateBoundedNumber = (raw: unknown, field: string): number | null => {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new ValidationError(`'${field}' must be a number`);
  const [min, max] = BOUNDS[field];
  if (n < min || n > max) throw new ValidationError(`'${field}' must be between ${min} and ${max}`);
  return n;
};

const validateAssumptions = (body: any): Record<string, number | null> => {
  const assumptions: Record<string, number | null> = {};
  for (const field of ASSUMPTION_FIELDS) {
    if (field in body) assumptions[field] = validateBoundedNumber(body[field], field);
  }
  return assumptions;
};

const validateDate = (raw: unknown, label: string, required: boolean): Date | null => {
  if (raw === undefined || raw === null || raw === "") {
    if (required) throw new ValidationError(`'${label}' is required`);
    return null;
  }
  const d = new Date(raw as string);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`'${label}' must be a valid date`);
  return d;
};

export const validateCreateInvestmentPayload = (body: any) => {
  if (!body || typeof body !== "object") throw new ValidationError("Request body is required");
  const { name, type, description, branchId, initialInvestment, plannedStartDate, expectedCompletionDate, projectLifeYears } = body;

  if (typeof name !== "string" || !name.trim()) throw new ValidationError("'name' is required");
  const investmentType = type && VALID_TYPES.includes(type) ? type : "CUSTOM";

  const initial = Number(initialInvestment);
  if (!Number.isFinite(initial) || initial <= 0) throw new ValidationError("'initialInvestment' must be a positive number");

  let parsedBranchId: number | null = null;
  if (branchId !== undefined && branchId !== null) parsedBranchId = validateId(branchId, "branchId");

  const life = projectLifeYears !== undefined && projectLifeYears !== null ? validateBoundedNumber(projectLifeYears, "projectLifeYears") : 5;

  return {
    branchId: parsedBranchId,
    name: name.trim(),
    type: investmentType as any,
    description: typeof description === "string" ? description : null,
    initialInvestment: initial,
    plannedStartDate: validateDate(plannedStartDate, "plannedStartDate", true)!,
    expectedCompletionDate: validateDate(expectedCompletionDate, "expectedCompletionDate", false),
    projectLifeYears: Math.round(life ?? 5),
    ...validateAssumptions(body),
  };
};

export const validateUpdateInvestmentPayload = (body: any) => {
  if (!body || typeof body !== "object") throw new ValidationError("Request body is required");
  const payload: Record<string, any> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) throw new ValidationError("'name' must be a non-empty string");
    payload.name = body.name.trim();
  }
  if (body.description !== undefined) payload.description = typeof body.description === "string" ? body.description : null;
  if (body.type !== undefined) {
    if (!VALID_TYPES.includes(body.type)) throw new ValidationError(`'type' must be one of ${VALID_TYPES.join(", ")}`);
    payload.type = body.type;
  }
  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status)) throw new ValidationError(`'status' must be one of ${VALID_STATUSES.join(", ")}`);
    payload.status = body.status;
  }
  if (body.initialInvestment !== undefined) {
    const n = Number(body.initialInvestment);
    if (!Number.isFinite(n) || n <= 0) throw new ValidationError("'initialInvestment' must be a positive number");
    payload.initialInvestment = n;
  }
  if (body.plannedStartDate !== undefined) payload.plannedStartDate = validateDate(body.plannedStartDate, "plannedStartDate", true);
  if (body.expectedCompletionDate !== undefined) payload.expectedCompletionDate = validateDate(body.expectedCompletionDate, "expectedCompletionDate", false);
  if (body.projectLifeYears !== undefined) payload.projectLifeYears = Math.round(validateBoundedNumber(body.projectLifeYears, "projectLifeYears") ?? 5);

  Object.assign(payload, validateAssumptions(body));
  return payload;
};
