export class ValidationError extends Error {}

export const KPI_KEYS = [
  "revenue", "orders", "avgOrderValue", "grossProfit", "grossProfitMarginPercentage",
  "ebitda", "ebitdaPercentage", "netProfit", "foodCostPercentage", "labourCostPercentage",
  "primeCostPercentage", "customerGrowthPercentage", "repeatCustomerRate", "branchCount",
  "activeEmployees", "inventoryValue", "cashPosition",
] as const;

export const validateId = (value: unknown, label: string): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new ValidationError(`A valid ${label} is required`);
  return n;
};

export const validateBranchIdParam = (value: unknown): number | null | undefined => {
  if (value === undefined) return undefined;
  if (value === "null" || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new ValidationError("A valid branchId is required");
  return n;
};

export const validateKpiKey = (value: unknown): string => {
  if (typeof value !== "string" || !(KPI_KEYS as readonly string[]).includes(value)) {
    throw new ValidationError(`'kpiKey' must be one of ${KPI_KEYS.join(", ")}`);
  }
  return value;
};

export const validateSetTargetPayload = (body: any) => {
  if (!body || typeof body !== "object") throw new ValidationError("Request body is required");
  const kpiKey = validateKpiKey(body.kpiKey);
  const targetValue = Number(body.targetValue);
  if (!Number.isFinite(targetValue)) throw new ValidationError("'targetValue' must be a number");
  let branchId: number | null = null;
  if (body.branchId !== undefined && body.branchId !== null) branchId = validateId(body.branchId, "branchId");
  return { kpiKey, targetValue, branchId };
};

export const validatePreferencePayload = (body: any) => {
  if (!body || typeof body !== "object") throw new ValidationError("Request body is required");
  return {
    layout: body.layout !== undefined ? body.layout : undefined,
    pinnedKpis: Array.isArray(body.pinnedKpis) ? body.pinnedKpis : undefined,
    defaultPeriod: typeof body.defaultPeriod === "string" ? body.defaultPeriod : undefined,
    defaultBranchId: body.defaultBranchId === null ? null : body.defaultBranchId !== undefined ? validateId(body.defaultBranchId, "defaultBranchId") : undefined,
  };
};

const VALID_GRANULARITIES = ["daily", "weekly", "monthly", "quarterly", "yearly"];
export const validateGranularity = (value: unknown): "daily" | "weekly" | "monthly" | "quarterly" | "yearly" => {
  if (typeof value === "string" && VALID_GRANULARITIES.includes(value)) return value as any;
  return "monthly";
};
