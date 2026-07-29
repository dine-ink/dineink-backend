import { BUDGET_CATEGORY_KEYS, BudgetItemInput } from "./budget.types";

export class ValidationError extends Error {}

const VALID_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"];

export const validateId = (value: unknown, label: string): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ValidationError(`A valid ${label} is required`);
  }
  return n;
};

export const validateFinancialYear = (value: unknown): string => {
  if (typeof value !== "string" || !/^\d{4}$/.test(value)) {
    throw new ValidationError("'financialYear' must be a 4-digit year string (e.g. '2026' for FY2026-27)");
  }
  return value;
};

export const validateCreateBudgetPayload = (body: any) => {
  if (!body || typeof body !== "object") throw new ValidationError("Request body is required");
  const { branchId, financialYear, name, notes, monthlyDefaults } = body;

  if (typeof name !== "string" || !name.trim()) throw new ValidationError("'name' is required");
  const fy = validateFinancialYear(financialYear);

  let parsedBranchId: number | null = null;
  if (branchId !== undefined && branchId !== null) {
    parsedBranchId = validateId(branchId, "branchId");
  }

  let parsedDefaults: Record<string, number> = {};
  if (monthlyDefaults !== undefined) {
    if (typeof monthlyDefaults !== "object" || monthlyDefaults === null) {
      throw new ValidationError("'monthlyDefaults' must be an object of { category: monthlyAmount }");
    }
    for (const [category, amount] of Object.entries(monthlyDefaults)) {
      if (!BUDGET_CATEGORY_KEYS.includes(category)) {
        throw new ValidationError(`Unknown budget category '${category}'`);
      }
      const n = Number(amount);
      if (!Number.isFinite(n) || n < 0) {
        throw new ValidationError(`monthlyDefaults['${category}'] must be a non-negative number`);
      }
      parsedDefaults[category] = n;
    }
  }

  return {
    branchId: parsedBranchId,
    financialYear: fy,
    name: name.trim(),
    notes: typeof notes === "string" ? notes : null,
    monthlyDefaults: parsedDefaults,
  };
};

export const validateUpdateBudgetPayload = (body: any) => {
  if (!body || typeof body !== "object") throw new ValidationError("Request body is required");
  const { name, notes, status } = body;
  const payload: { name?: string; notes?: string | null; status?: string } = {};

  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) throw new ValidationError("'name' must be a non-empty string");
    payload.name = name.trim();
  }
  if (notes !== undefined) {
    payload.notes = typeof notes === "string" ? notes : null;
  }
  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      throw new ValidationError(`'status' must be one of: ${VALID_STATUSES.join(", ")}`);
    }
    payload.status = status;
  }
  return payload;
};

export const validateBudgetItems = (body: any): BudgetItemInput[] => {
  if (!body || !Array.isArray(body.items)) {
    throw new ValidationError("'items' must be an array");
  }
  return body.items.map((item: any, i: number) => {
    if (!item || typeof item !== "object") throw new ValidationError(`items[${i}] must be an object`);
    const { category, year, month, amount, notes } = item;
    if (!BUDGET_CATEGORY_KEYS.includes(category)) {
      throw new ValidationError(`items[${i}].category '${category}' is not a known budget category`);
    }
    const y = Number(year);
    const m = Number(month);
    const a = Number(amount);
    if (!Number.isFinite(y) || y < 2000 || y > 2100) throw new ValidationError(`items[${i}].year must be a valid year`);
    if (!Number.isFinite(m) || m < 1 || m > 12) throw new ValidationError(`items[${i}].month must be between 1 and 12`);
    if (!Number.isFinite(a) || a < 0) throw new ValidationError(`items[${i}].amount must be a non-negative number`);
    return { category, year: y, month: m, amount: a, notes: typeof notes === "string" ? notes : null };
  });
};

export const validateDuplicatePayload = (body: any) => {
  const { name, financialYear, branchId } = body || {};
  return {
    name: typeof name === "string" && name.trim() ? name.trim() : undefined,
    financialYear: financialYear !== undefined ? validateFinancialYear(financialYear) : undefined,
    branchId: branchId === undefined ? undefined : branchId === null ? null : validateId(branchId, "branchId"),
  };
};
