import { Request, Response } from "express";
import {
  computeMetricsForInvestmentService,
  createInvestmentService,
  deleteInvestmentService,
  getForecastComparisonService,
  getInvestmentService,
  getPortfolioSummaryService,
  listInvestmentsService,
  listInvestmentsWithMetricsService,
  rankBranchInvestmentsService,
  updateInvestmentService,
} from "./investment.service";
import { ValidationError, validateCreateInvestmentPayload, validateId, validateUpdateInvestmentPayload } from "./investment.validation";

const handle = (fn: (req: Request, res: Response) => Promise<any>) => async (req: Request, res: Response) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) return res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.log(error);
    return res.status(500).json({ success: false, message: "Investment operation failed" });
  }
};

const parseScenarioId = (raw: unknown): number | undefined => {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

const parseBranchIdFilter = (raw: unknown): number | null | undefined => {
  if (raw === undefined) return undefined;
  if (raw === "null" || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

export const createInvestment = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const payload = validateCreateInvestmentPayload(req.body);
  return createInvestmentService(restaurantId, payload, (req as any).user?.id);
});

export const listInvestments = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  return listInvestmentsService(restaurantId, {
    branchId: parseBranchIdFilter(req.query.branchId),
    status: req.query.status as string | undefined,
    type: req.query.type as string | undefined,
  });
});

export const listInvestmentsWithMetrics = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  return listInvestmentsWithMetricsService(
    restaurantId,
    { branchId: parseBranchIdFilter(req.query.branchId), status: req.query.status as string | undefined, type: req.query.type as string | undefined },
    parseScenarioId(req.query.scenarioId),
  );
});

export const getInvestment = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const investmentId = validateId(req.params.investmentId, "investmentId");
  return getInvestmentService(restaurantId, investmentId);
});

export const updateInvestment = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const investmentId = validateId(req.params.investmentId, "investmentId");
  const payload = validateUpdateInvestmentPayload(req.body);
  return updateInvestmentService(restaurantId, investmentId, payload, (req as any).user?.id);
});

export const deleteInvestment = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const investmentId = validateId(req.params.investmentId, "investmentId");
  await deleteInvestmentService(restaurantId, investmentId);
  return { deleted: true };
});

export const getInvestmentMetrics = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const investmentId = validateId(req.params.investmentId, "investmentId");
  return computeMetricsForInvestmentService(restaurantId, investmentId, parseScenarioId(req.query.scenarioId));
});

export const getInvestmentForecastComparison = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const investmentId = validateId(req.params.investmentId, "investmentId");
  return getForecastComparisonService(restaurantId, investmentId);
});

export const getPortfolio = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  return getPortfolioSummaryService(restaurantId, { branchId: parseBranchIdFilter(req.query.branchId) });
});

export const getBranchRanking = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  return rankBranchInvestmentsService(restaurantId);
});
