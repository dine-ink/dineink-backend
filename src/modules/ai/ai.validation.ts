import { PeriodKey } from "../../utils/dateRange";

export class ValidationError extends Error {}

export const VALID_PERIODS: PeriodKey[] = [
  "today", "yesterday", "last7days", "last30days", "last90days",
  "currentWeek", "previousWeek", "currentMonth", "previousMonth",
  "currentQuarter", "previousQuarter", "currentYear", "previousYear",
  "rolling12Months", "custom",
];

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

export const validatePercentage = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ValidationError("'percentage' must be a number");
  return n;
};
