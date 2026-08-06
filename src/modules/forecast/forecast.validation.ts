import { ForecastModelValue, ForecastPeriodTypeValue } from "./forecast.types";

export class ValidationError extends Error {}

const VALID_PERIOD_TYPES: ForecastPeriodTypeValue[] = ["NEXT_WEEK", "NEXT_MONTH", "NEXT_QUARTER", "NEXT_6_MONTHS", "NEXT_YEAR"];
const VALID_MODELS: ForecastModelValue[] = ["HISTORICAL_TREND", "MOVING_AVERAGE", "SEASONAL"];

export const validateId = (value: unknown, label: string): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new ValidationError(`A valid ${label} is required`);
  return n;
};

export const validatePeriodType = (value: unknown): ForecastPeriodTypeValue => {
  if (typeof value === "string" && (VALID_PERIOD_TYPES as string[]).includes(value)) return value as ForecastPeriodTypeValue;
  throw new ValidationError(`'period' must be one of ${VALID_PERIOD_TYPES.join(", ")}`);
};

export const validateModel = (value: unknown): ForecastModelValue => {
  if (value === undefined || value === null || value === "") return "HISTORICAL_TREND";
  if (typeof value === "string" && (VALID_MODELS as string[]).includes(value)) return value as ForecastModelValue;
  throw new ValidationError(`'model' must be one of ${VALID_MODELS.join(", ")}`);
};

export const validateBranchIdParam = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "" || value === "null") return null;
  return validateId(value, "branchId");
};

/** Optional positive integer query param with a default — used for `topN` on the demand/inventory forecast routes. */
export const validateOptionalCount = (value: unknown, fallback: number): number => {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new ValidationError("'topN' must be a positive number");
  return Math.round(n);
};
