import { Request, Response } from "express";
import { PeriodKey } from "../../utils/dateRange";
import {
  cloneScenarioService,
  createScenarioService,
  deleteScenarioService,
  getScenarioService,
  listScenariosService,
  resetScenarioFieldsService,
  runWhatIfService,
  updateScenarioService,
} from "./scenario.service";
import {
  ValidationError,
  validateCreateScenarioPayload,
  validateId,
  validateOverrides,
  validateResetFieldsPayload,
  validateUpdateScenarioPayload,
} from "./scenario.validation";

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
    return res.status(500).json({ success: false, message: "Scenario operation failed" });
  }
};

export const createScenario = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const payload = validateCreateScenarioPayload(req.body);
  return createScenarioService(restaurantId, payload, (req as any).user?.id);
});

export const listScenarios = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = req.query.branchId !== undefined ? (req.query.branchId === "null" ? null : Number(req.query.branchId)) : undefined;
  const type = req.query.type as string | undefined;
  const activeOnly = req.query.activeOnly === "true";
  return listScenariosService(restaurantId, { branchId, type, activeOnly });
});

export const getScenario = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const scenarioId = validateId(req.params.scenarioId, "scenarioId");
  return getScenarioService(restaurantId, scenarioId);
});

export const updateScenario = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const scenarioId = validateId(req.params.scenarioId, "scenarioId");
  const payload = validateUpdateScenarioPayload(req.body);
  return updateScenarioService(restaurantId, scenarioId, payload, (req as any).user?.id);
});

export const cloneScenario = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const scenarioId = validateId(req.params.scenarioId, "scenarioId");
  const { name, branchId } = req.body || {};
  const overrides: { name?: string; branchId?: number | null } = {};
  if (typeof name === "string" && name.trim()) overrides.name = name.trim();
  if (branchId !== undefined) overrides.branchId = branchId === null ? null : validateId(branchId, "branchId");
  return cloneScenarioService(restaurantId, scenarioId, overrides, (req as any).user?.id);
});

export const resetScenarioFields = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const scenarioId = validateId(req.params.scenarioId, "scenarioId");
  const fields = validateResetFieldsPayload(req.body);
  return resetScenarioFieldsService(restaurantId, scenarioId, fields, (req as any).user?.id);
});

export const deleteScenario = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const scenarioId = validateId(req.params.scenarioId, "scenarioId");
  await deleteScenarioService(restaurantId, scenarioId);
  return { deleted: true };
});

export const getScenarioWhatIf = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const scenarioId = validateId(req.params.scenarioId, "scenarioId");
  const periodParam = (req.query.period as string) || "currentMonth";
  const period: PeriodKey = (VALID_PERIODS as string[]).includes(periodParam) ? (periodParam as PeriodKey) : "currentMonth";
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  // Live overrides for interactive what-if sliders — POST body only, never
  // persisted; merged on top of the scenario's saved overrides for this one
  // calculation. Absent on a plain GET/no-body request.
  const liveOverrides = req.body && Object.keys(req.body).length > 0 ? validateOverrides(req.body) : undefined;
  return runWhatIfService(restaurantId, scenarioId, period, from, to, liveOverrides);
});
