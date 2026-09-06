import { z, type ZodType } from "zod";
import { badRequest } from "./apiError";

/**
 * Request validation.
 *
 * Every endpoint used to hand-check its own input, which meant coverage was
 * whatever each author remembered: eleven modules declared their own
 * `ValidationError`, `validateId` was copy-pasted seven times, five
 * `*.validation.ts` files were empty, and seven modules had none at all — so a
 * numeric column could receive `"abc"`, an unbounded string could reach a
 * length-limited column, and a date range with `from` after `to` was answered
 * rather than refused.
 *
 * A failed parse becomes a 400 in the API's own error shape, with the offending
 * fields in `details`, so a form can put the message next to the input rather
 * than at the top.
 */

const toDetails = (error: z.ZodError, fallbackLabel: string) =>
  error.issues.map((issue) => ({
    field: issue.path.join(".") || `(${fallbackLabel})`,
    message: issue.message,
  }));

export const parseBody = <T>(schema: ZodType<T>, body: unknown): T => {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;

  const details = toDetails(result.error, "body");
  // The first field's message is the one shown when the caller has nowhere to
  // put per-field errors; it beats a generic "validation failed".
  throw badRequest(details[0]?.message ?? "Check the values you entered.", "VALIDATION_FAILED", details);
};

export const parseQuery = <T>(schema: ZodType<T>, query: unknown): T => {
  const result = schema.safeParse(query ?? {});
  if (result.success) return result.data;
  const details = toDetails(result.error, "query");
  throw badRequest(details[0]?.message ?? "Check the filters you applied.", "VALIDATION_FAILED", details);
};

export const parseParams = <T>(schema: ZodType<T>, params: unknown): T => {
  const result = schema.safeParse(params ?? {});
  if (result.success) return result.data;
  const details = toDetails(result.error, "params");
  throw badRequest(details[0]?.message ?? "That address isn't valid.", "VALIDATION_FAILED", details);
};

// ─── Reusable field schemas ──────────────────────────────────────────────────

/** Trimmed, non-empty, length-capped. The cap matches nothing in particular in
 *  Postgres (TEXT is unbounded) — it exists so a paste accident cannot put a
 *  megabyte of text in a name column. */
export const shortText = (max = 200) => z.string().trim().min(1).max(max);

export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

export const longText = (max = 5000) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

export const emailField = z
  .string()
  .trim()
  .email("Enter a valid email address.")
  .max(254)
  .nullish()
  .transform((value) => (value ? value.toLowerCase() : null));

/** A required email — signup, login, password reset. Lowercased to match
 *  `normalizeEmail`, which every write and lookup already goes through. */
export const requiredEmail = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .email("Enter a valid email address.")
  .max(254)
  .transform((value) => value.toLowerCase());

export const phoneField = z
  .string()
  .trim()
  .max(32)
  .nullish()
  .transform((value) => (value ? value : null));

/** A positive database id arriving as a string in a query or path. Capped at
 *  int4 so an oversized value is refused here rather than overflowing in the
 *  driver. */
export const idField = z.coerce.number().int().positive().max(2_147_483_647);

export const optionalId = z.coerce
  .number()
  .int()
  .positive()
  .max(2_147_483_647)
  .nullish()
  .transform((value) => value ?? null);

/** The shape of `/:restaurantId`, `/:branchId` and friends. */
export const idParams = <K extends string>(...keys: K[]) =>
  z.object(Object.fromEntries(keys.map((key) => [key, idField])) as Record<K, typeof idField>);

/**
 * A date arriving as an ISO string or YYYY-MM-DD. Rejects an unparseable value
 * rather than quietly producing Invalid Date, which Prisma then stores as null.
 */
export const dateField = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date.")
  .transform((value) => new Date(value));

export const optionalDate = z
  .string()
  .trim()
  .refine((value) => value === "" || !Number.isNaN(Date.parse(value)), "Enter a valid date.")
  .nullish()
  .transform((value) => (value ? new Date(value) : null));

/**
 * A monetary amount. Non-negative and capped at the Decimal(12,2) the column
 * can hold, so an over-large figure is refused with a message rather than
 * failing at the driver with a numeric overflow.
 */
export const moneyField = z.coerce
  .number()
  .nonnegative("Amount cannot be negative.")
  .max(9_999_999_999, "That amount is too large.");

export const optionalMoney = z.coerce
  .number()
  .nonnegative("Amount cannot be negative.")
  .max(9_999_999_999, "That amount is too large.")
  .nullish()
  .transform((value) => (value === undefined ? null : value));

/** A count of things — covers, portions, headcount. Whole and non-negative. */
export const quantityField = z.coerce
  .number()
  .nonnegative("Quantity cannot be negative.")
  .max(1_000_000, "That quantity is too large.");

/** A percentage expressed 0–100, not 0–1. */
export const percentField = z.coerce
  .number()
  .min(0, "Percentage cannot be negative.")
  .max(100, "Percentage cannot be above 100.");

/** Query-string booleans arrive as "true"/"false"/"1"/"0", never as booleans. */
export const booleanFlag = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((value) => value === true || value === "true" || value === "1");

/** A reason string on an action that requires one. */
export const reasonField = z.string().trim().min(3, "Give a reason.").max(1000);

export const optionalReason = z
  .string()
  .trim()
  .max(1000)
  .nullish()
  .transform((value) => (value ? value : null));

/** Pagination and sorting, shared by every list endpoint. */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().trim().max(200).optional(),
  sortBy: z.string().trim().max(50).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});

/**
 * A from/to range. Refuses a reversed range instead of returning an empty
 * result the caller then has to explain.
 */
export const dateRangeSchema = z
  .object({
    from: z.string().trim().optional(),
    to: z.string().trim().optional(),
  })
  .refine(
    (value) => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to),
    { message: "The start date must be before the end date.", path: ["from"] },
  );

/**
 * The named reporting periods `utils/dateRange` understands, plus `custom`.
 * Kept here so every analytics/report endpoint refuses an unknown period at the
 * edge instead of silently falling back to a default range.
 */
export const PERIOD_KEYS = [
  "today", "yesterday", "last7days", "last30days", "last90days",
  "currentWeek", "previousWeek", "currentMonth", "previousMonth",
  "currentQuarter", "previousQuarter", "currentYear", "previousYear",
  "rolling12Months", "custom",
] as const;

export const periodField = z.enum(PERIOD_KEYS);

/** The period plus the custom from/to it may carry — the shape almost every
 *  analytics endpoint takes. */
export const periodQuerySchema = z
  .object({
    period: periodField.optional(),
    startDate: z.string().trim().optional(),
    endDate: z.string().trim().optional(),
  })
  .refine(
    (value) =>
      !value.startDate ||
      !value.endDate ||
      Date.parse(value.startDate) <= Date.parse(value.endDate),
    { message: "The start date must be before the end date.", path: ["startDate"] },
  );

export { z };
