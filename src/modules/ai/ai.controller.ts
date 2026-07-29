import { Request, Response } from "express";
import { PeriodKey } from "../../utils/dateRange";
import {
  answerBestPerformingBranchService,
  answerBestROIInvestmentsService,
  answerKpisNeedingAttentionService,
  answerWhatIfSalesIncreaseService,
  answerWhyFoodCostChangingService,
  answerWhyProfitChangedService,
  generateInsightsService,
  getAnomaliesService,
  getBranchNarrativesService,
  getExecutiveBriefService,
  getInsightTimelineService,
  getOpportunitiesService,
  getRecommendationsService,
  getRiskAssessmentService,
} from "./ai.service";
import { validateBranchIdParam, validateId, validatePercentage, ValidationError, VALID_PERIODS } from "./ai.validation";

const handle = (fn: (req: Request, res: Response) => Promise<any>) => async (req: Request, res: Response) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) return res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.log(error);
    return res.status(500).json({ success: false, message: "AI Financial Advisor operation failed" });
  }
};

const parsePeriod = (req: Request): PeriodKey => {
  const raw = (req.query.period as string) || "currentMonth";
  return (VALID_PERIODS as string[]).includes(raw) ? (raw as PeriodKey) : "currentMonth";
};

export const getInsights = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateBranchIdParam(req.query.branchId) ?? null;
  return generateInsightsService(restaurantId, branchId, parsePeriod(req), req.query.from as string | undefined, req.query.to as string | undefined);
});

export const getRisks = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateBranchIdParam(req.query.branchId) ?? null;
  return getRiskAssessmentService(restaurantId, branchId, parsePeriod(req), req.query.from as string | undefined, req.query.to as string | undefined);
});

export const getOpportunities = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateBranchIdParam(req.query.branchId) ?? null;
  return getOpportunitiesService(restaurantId, branchId, parsePeriod(req), req.query.from as string | undefined, req.query.to as string | undefined);
});

export const getRecommendations = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateBranchIdParam(req.query.branchId) ?? null;
  return getRecommendationsService(restaurantId, branchId, parsePeriod(req), req.query.from as string | undefined, req.query.to as string | undefined);
});

export const getAnomalies = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateBranchIdParam(req.query.branchId) ?? null;
  return getAnomaliesService(restaurantId, branchId, parsePeriod(req), req.query.from as string | undefined, req.query.to as string | undefined);
});

export const getInsightTimeline = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateBranchIdParam(req.query.branchId);
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  return getInsightTimelineService(restaurantId, branchId, Number.isFinite(limit) && limit > 0 ? limit : 50);
});

export const getExecutiveBrief = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateBranchIdParam(req.query.branchId) ?? null;
  return getExecutiveBriefService(restaurantId, branchId, parsePeriod(req), req.query.from as string | undefined, req.query.to as string | undefined);
});

export const getBranchNarratives = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  return getBranchNarrativesService(restaurantId, parsePeriod(req), req.query.from as string | undefined, req.query.to as string | undefined);
});

export const askWhyProfitChanged = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateBranchIdParam(req.query.branchId) ?? null;
  return answerWhyProfitChangedService(restaurantId, branchId, parsePeriod(req), req.query.from as string | undefined, req.query.to as string | undefined);
});

export const askBestPerformingBranch = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  return answerBestPerformingBranchService(restaurantId, parsePeriod(req), req.query.from as string | undefined, req.query.to as string | undefined);
});

export const askWhyFoodCostChanging = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateBranchIdParam(req.query.branchId) ?? null;
  return answerWhyFoodCostChangingService(restaurantId, branchId, parsePeriod(req), req.query.from as string | undefined, req.query.to as string | undefined);
});

export const askBestROIInvestments = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const limit = req.query.limit ? Number(req.query.limit) : 5;
  return answerBestROIInvestmentsService(restaurantId, Number.isFinite(limit) && limit > 0 ? limit : 5);
});

export const askWhatIfSalesIncrease = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateBranchIdParam(req.query.branchId) ?? null;
  const percentage = validatePercentage(req.query.percentage);
  const period = parsePeriod(req);
  return answerWhatIfSalesIncreaseService(restaurantId, branchId, percentage, period);
});

export const askKpisNeedingAttention = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateBranchIdParam(req.query.branchId) ?? null;
  return answerKpisNeedingAttentionService(restaurantId, branchId, parsePeriod(req), req.query.from as string | undefined, req.query.to as string | undefined);
});
