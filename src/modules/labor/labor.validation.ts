// Input validation for the Labor & Kitchen Capacity Engine. Same two-error-class
// shape the forecast and equipment modules use: ValidationError → HTTP 400,
// ForbiddenError → HTTP 403 (thrown by service functions that look a row up by
// its own id, where the URL carries no restaurantId to gate on).

export class ValidationError extends Error {}
export class ForbiddenError extends Error {}

export const validateId = (value: unknown, label: string): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new ValidationError(`A valid ${label} is required`);
  return Math.round(n);
};

export const validateOptionalId = (value: unknown, label: string): number | null => {
  if (value === undefined || value === null || value === "" || value === "null") return null;
  return validateId(value, label);
};

export const validateNonEmptyString = (value: unknown, label: string, maxLength = 120): string => {
  if (typeof value !== "string" || !value.trim()) throw new ValidationError(`'${label}' is required`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new ValidationError(`'${label}' must be ${maxLength} characters or fewer`);
  return trimmed;
};

/**
 * Station code — uppercased, alphanumeric + underscore. Normalised rather than
 * rejected on case/spacing so "wood fired oven" and "WOOD_FIRED_OVEN" cannot
 * become two different stations that split one station's workload in half.
 */
export const validateStationCode = (value: unknown): string => {
  const raw = validateNonEmptyString(value, "code", 40);
  const code = raw.toUpperCase().replace(/[\s-]+/g, "_").replace(/[^A-Z0-9_]/g, "");
  if (!code) throw new ValidationError("'code' must contain at least one letter or number");
  return code;
};

/**
 * A minutes-per-unit labor standard. Zero is allowed and meaningful — it is how
 * an owner says "this item does not touch this station" without deleting the
 * row. The 240-minute ceiling catches a seconds-vs-minutes unit mix-up.
 */
export const validateMinutes = (value: unknown, label = "minutes"): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new ValidationError(`'${label}' must be zero or a positive number`);
  if (n > 240) throw new ValidationError(`'${label}' must be 240 or fewer (values look like they may be in seconds)`);
  return Math.round(n * 100) / 100;
};

export const validateOptionalPositiveInt = (value: unknown, label: string): number | null => {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new ValidationError(`'${label}' must be a positive number`);
  return Math.round(n);
};

/** Productive-time fraction. Bounded to 0.1–1: 0 would divide by zero into an infinite staff requirement, and above 1 would claim more than 60 productive minutes in an hour. */
export const validateOptionalUtilizationFactor = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0.1 || n > 1) {
    throw new ValidationError("'utilizationFactor' must be between 0.1 and 1");
  }
  return Math.round(n * 100) / 100;
};

export const validateProficiency = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 5) throw new ValidationError("'proficiency' must be between 1 and 5");
  return Math.round(n);
};

/** Throughput multiplier vs. the standard time. 0.25–3 keeps a typo ("11" for "1.1") from making one cook worth eleven. */
export const validateSpeedFactor = (value: unknown): number => {
  if (value === undefined || value === null || value === "") return 1;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0.25 || n > 3) throw new ValidationError("'speedFactor' must be between 0.25 and 3");
  return Math.round(n * 100) / 100;
};

/** Hour-of-day bound for the analysed window. */
export const validateHour = (value: unknown, label: string, fallback: number): number => {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 23) throw new ValidationError(`'${label}' must be an hour between 0 and 23`);
  return Math.round(n);
};

export const validateOptionalTrailingDays = (value: unknown, fallback: number): number => {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 365) throw new ValidationError("'days' must be between 1 and 365");
  return Math.round(n);
};

export const validateBooleanFlag = (value: unknown, fallback = false): boolean => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new ValidationError("Expected a boolean value");
};
