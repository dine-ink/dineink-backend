import { Request, Response } from "express";
import {
  generateForecastService,
  getDemandForecastService,
  getForecastAccuracyReportService,
  getForecastSnapshotService,
  getForecastVsActualService,
  getInventoryForecastService,
  getPeakHourForecastService,
  listForecastSnapshotsService,
  rankBranchForecastsService,
} from "./forecast.service";
import { ValidationError, validateBranchIdParam, validateId, validateModel, validateOptionalCount, validatePeriodType } from "./forecast.validation";

const handle = (fn: (req: Request, res: Response) => Promise<any>) => async (req: Request, res: Response) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) return res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.log(error);
    return res.status(500).json({ success: false, message: "Forecast operation failed" });
  }
};

export const generateForecast = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateBranchIdParam(req.query.branchId);
  const periodType = validatePeriodType(req.query.period);
  const model = validateModel(req.query.model);
  return generateForecastService(restaurantId, branchId, periodType, model, (req as any).user?.id);
});

export const listForecasts = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = req.query.branchId !== undefined ? validateBranchIdParam(req.query.branchId) : undefined;
  const periodType = req.query.period as string | undefined;
  return listForecastSnapshotsService(restaurantId, { branchId, periodType });
});

export const getForecast = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const forecastId = validateId(req.params.forecastId, "forecastId");
  return getForecastSnapshotService(restaurantId, forecastId);
});

export const getForecastVsActual = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const forecastId = validateId(req.params.forecastId, "forecastId");
  return getForecastVsActualService(restaurantId, forecastId);
});

export const getForecastAccuracy = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateBranchIdParam(req.query.branchId);
  return getForecastAccuracyReportService(restaurantId, branchId);
});

export const getBranchRanking = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const periodType = validatePeriodType(req.query.period);
  const model = validateModel(req.query.model);
  return rankBranchForecastsService(restaurantId, periodType, model);
});

// ── Peak Hour / Demand / Inventory forecasting — same restaurantId path param + branchId/period/model query param convention as generateForecast above; branchId is required here (not nullable) since order-volume/staffing/consumption are inherently per-branch, unlike the restaurant-wide financial forecast. ──

export const getPeakHourForecast = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateId(req.query.branchId, "branchId");
  const periodType = validatePeriodType(req.query.period);
  const model = validateModel(req.query.model);
  return getPeakHourForecastService(restaurantId, branchId, periodType, model);
});

export const getDemandForecast = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateId(req.query.branchId, "branchId");
  const periodType = validatePeriodType(req.query.period);
  const model = validateModel(req.query.model);
  const topN = validateOptionalCount(req.query.topN, 10);
  return getDemandForecastService(restaurantId, branchId, periodType, model, topN);
});

export const getInventoryForecast = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateId(req.query.branchId, "branchId");
  const model = validateModel(req.query.model);
  const topN = validateOptionalCount(req.query.topN, 10);
  return getInventoryForecastService(restaurantId, branchId, model, topN);
});
