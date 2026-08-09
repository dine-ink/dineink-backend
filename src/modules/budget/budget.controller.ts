import { Request, Response } from "express";
import {
  createBudgetService,
  deleteBudgetService,
  duplicateBudgetService,
  getBudgetService,
  getBudgetVarianceService,
  getFixedCostDefaultsService,
  listBudgetsService,
  updateBudgetService,
  upsertBudgetItemsService,
} from "./budget.service";
import {
  ValidationError,
  validateBudgetItems,
  validateCreateBudgetPayload,
  validateDuplicatePayload,
  validateId,
  validateUpdateBudgetPayload,
} from "./budget.validation";
import { PeriodKey } from "../../utils/dateRange";

const VALID_PERIODS: PeriodKey[] = [
  "today", "yesterday", "last7days", "last30days", "last90days",
  "currentWeek", "previousWeek", "currentMonth", "previousMonth",
  "currentQuarter", "previousQuarter", "currentYear", "previousYear",
  "rolling12Months", "custom",
];

const handle = (fn: (req: Request, res: Response) => Promise<any>) => async (req: Request, res: Response) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) return res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.log(error);
    return res.status(500).json({ success: false, message: "Budget operation failed" });
  }
};

export const createBudget = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const payload = validateCreateBudgetPayload(req.body);
  return createBudgetService(restaurantId, payload, (req as any).user?.id);
});

export const getFixedCostDefaults = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = req.query.branchId !== undefined ? Number(req.query.branchId) : null;
  return getFixedCostDefaultsService(restaurantId, branchId);
});

export const listBudgets = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = req.query.branchId !== undefined ? Number(req.query.branchId) : undefined;
  const financialYear = req.query.financialYear as string | undefined;
  const status = req.query.status as string | undefined;
  return listBudgetsService(restaurantId, { branchId, financialYear, status });
});

export const getBudget = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const budgetId = validateId(req.params.budgetId, "budgetId");
  return getBudgetService(restaurantId, budgetId);
});

export const deleteBudget = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const budgetId = validateId(req.params.budgetId, "budgetId");
  await deleteBudgetService(restaurantId, budgetId);
});

export const updateBudget = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const budgetId = validateId(req.params.budgetId, "budgetId");
  const payload = validateUpdateBudgetPayload(req.body);
  return updateBudgetService(restaurantId, budgetId, payload, (req as any).user?.id);
});

export const upsertBudgetItems = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const budgetId = validateId(req.params.budgetId, "budgetId");
  const items = validateBudgetItems(req.body);
  return upsertBudgetItemsService(restaurantId, budgetId, items, (req as any).user?.id);
});

export const duplicateBudget = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const budgetId = validateId(req.params.budgetId, "budgetId");
  const overrides = validateDuplicatePayload(req.body);
  return duplicateBudgetService(restaurantId, budgetId, overrides, (req as any).user?.id);
});

export const getBudgetVariance = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const budgetId = validateId(req.params.budgetId, "budgetId");
  const periodParam = (req.query.period as string) || "currentMonth";
  const period: PeriodKey = (VALID_PERIODS as string[]).includes(periodParam) ? (periodParam as PeriodKey) : "currentMonth";
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  return getBudgetVarianceService(restaurantId, budgetId, period, from, to);
});
