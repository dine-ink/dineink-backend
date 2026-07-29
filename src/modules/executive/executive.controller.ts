import { Request, Response } from "express";
import { PeriodKey } from "../../utils/dateRange";
import {
  deleteKpiTargetService,
  getBusinessHealthScoreService,
  getDashboardPreferenceService,
  getExecutiveAlertsService,
  getExecutiveOverviewService,
  getExecutiveTimelineService,
  getInsightPanelsService,
  getKpiScorecardsService,
  getMultiBranchExecutiveViewService,
  listKpiTargetsService,
  saveDashboardPreferenceService,
  setKpiTargetService,
} from "./executive.service";
import {
  ValidationError,
  validateBranchIdParam,
  validateGranularity,
  validateId,
  validateKpiKey,
  validatePreferencePayload,
  validateSetTargetPayload,
} from "./executive.validation";

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
    return res.status(500).json({ success: false, message: "Executive dashboard operation failed" });
  }
};

const parsePeriod = (req: Request): PeriodKey => {
  const raw = (req.query.period as string) || "currentMonth";
  return (VALID_PERIODS as string[]).includes(raw) ? (raw as PeriodKey) : "currentMonth";
};

export const getOverview = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateBranchIdParam(req.query.branchId) ?? null;
  return getExecutiveOverviewService(restaurantId, branchId, parsePeriod(req), req.query.from as string | undefined, req.query.to as string | undefined);
});

export const getScorecards = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateBranchIdParam(req.query.branchId) ?? null;
  return getKpiScorecardsService(restaurantId, branchId, parsePeriod(req), req.query.from as string | undefined, req.query.to as string | undefined);
});

export const getHealthScore = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateBranchIdParam(req.query.branchId) ?? null;
  return getBusinessHealthScoreService(restaurantId, branchId, parsePeriod(req), req.query.from as string | undefined, req.query.to as string | undefined);
});

export const getMultiBranchView = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  return getMultiBranchExecutiveViewService(restaurantId, parsePeriod(req), req.query.from as string | undefined, req.query.to as string | undefined);
});

export const getTimeline = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateBranchIdParam(req.query.branchId) ?? null;
  return getExecutiveTimelineService(restaurantId, branchId, validateGranularity(req.query.granularity));
});

export const getAlerts = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateBranchIdParam(req.query.branchId) ?? null;
  return getExecutiveAlertsService(restaurantId, branchId, parsePeriod(req), req.query.from as string | undefined, req.query.to as string | undefined);
});

export const getInsightPanels = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateBranchIdParam(req.query.branchId) ?? null;
  return getInsightPanelsService(restaurantId, branchId, parsePeriod(req), req.query.from as string | undefined, req.query.to as string | undefined);
});

export const listKpiTargets = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  return listKpiTargetsService(restaurantId, validateBranchIdParam(req.query.branchId));
});

export const setKpiTarget = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const { kpiKey, targetValue, branchId } = validateSetTargetPayload(req.body);
  return setKpiTargetService(restaurantId, branchId, kpiKey, targetValue, (req as any).user?.id);
});

export const deleteKpiTarget = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const kpiKey = validateKpiKey(req.params.kpiKey);
  const branchId = validateBranchIdParam(req.query.branchId) ?? null;
  await deleteKpiTargetService(restaurantId, branchId, kpiKey);
  return { deleted: true };
});

// Preferences are always scoped to the authenticated caller's own id (from
// the verified JWT via authMiddleware) — never a client-supplied userId —
// so one user can never read or overwrite another user's dashboard layout.
export const getPreference = handle(async (req) => {
  const userId = validateId((req as any).user?.id, "userId");
  return getDashboardPreferenceService(userId);
});

export const savePreference = handle(async (req) => {
  const userId = validateId((req as any).user?.id, "userId");
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const payload = validatePreferencePayload(req.body);
  const filtered = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
  return saveDashboardPreferenceService(userId, restaurantId, filtered);
});
