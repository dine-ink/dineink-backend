import { Request, Response } from "express";

import {
  getBranchInsightsData,
  getDashboardOverviewDataService,
  getDashboardOverviewService,
  getRestaurantInsightsData,
  saveRestaurantInsightsData,
  getTableOperationsService,
} from "./analytics.service";
import {
  getBranchComparisonService,
  getCityComparisonService,
} from "./branchComparison.service";
import {
  getKitchenAnalyticsService,
  getHourlyHeatmapService,
  getCustomerRFMService,
  getStaffProductivityService,
  getRevenueForecastService,
  getMenuEngineeringService,
} from "./analyticsAdvanced.service";

export const getRestaurantDashboardOverview = async (
  req: Request,
  res: Response,
) => {
  try {
    const restaurantId = Number(req.params.restaurantId);

    const branchId = req.query.branchId ? Number(req.query.branchId) : null;

    const range = req.query.range as string;

    const from = req.query.from as string;

    const to = req.query.to as string;

    const data = await getDashboardOverviewService(
      restaurantId,
      branchId,
      range,
      from,
      to,
    );

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.log(error);

    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const getBranchDashboardOverview = async (
  req: Request,
  res: Response,
) => {
  try {
    const restaurantId = Number(req.params.restaurantId);

    const branchId = Number(req.params.branchId);

    const range = req.query.range as string;

    const data = await getDashboardOverviewService(
      restaurantId,
      branchId,
      range,
    );

    return res.status(200).json({
      success: true,

      data,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,

      message: error.message,
    });
  }
};

export const saveRestaurantInsights = async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const insights = await saveRestaurantInsightsData(data);
    return res.json({
      success: true,
      data: insights,
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({
      success: false,
      message: "Failed to save insights",
    });
  }
};

export const getBranchInsights = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);

    const branchId = Number(req.params.branchId);

    const insights = await getBranchInsightsData(restaurantId, branchId);

    return res.json({
      success: true,
      data: insights,
    });
  } catch (err) {
    console.log(err);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch branch insights",
    });
  }
};

export const getTableOperations = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const from = req.query.from as string;
    const to = req.query.to as string;

    const data = await getTableOperationsService(restaurantId, branchId, from, to);

    return res.json({ success: true, data });
  } catch (err: any) {
    console.log(err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch table operations analytics",
    });
  }
};

export const getRestaurantInsights = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);

    const insights = await getRestaurantInsightsData(restaurantId);

    return res.json({
      success: true,
      data: insights,
    });
  } catch (err) {
    console.log(err);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch restaurant insights",
    });
  }
};

export const getDashboardOverview = async (req: Request, res: Response) => {
  try {
    const range = req.query.range as string;
    const data = await getDashboardOverviewDataService(range);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const getBranchComparison = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const data = await getBranchComparisonService(restaurantId, from, to);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const getCityComparison = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const data = await getCityComparisonService(restaurantId, from, to);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

const extractParams = (req: Request) => ({
  restaurantId: Number(req.params.restaurantId),
  branchId: req.query.branchId ? Number(req.query.branchId) : undefined,
  from: req.query.from as string | undefined,
  to: req.query.to as string | undefined,
});

export const getKitchenAnalytics = async (req: Request, res: Response) => {
  try {
    const { restaurantId, branchId, from, to } = extractParams(req);
    const data = await getKitchenAnalyticsService(restaurantId, branchId, from, to);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const getHourlyHeatmap = async (req: Request, res: Response) => {
  try {
    const { restaurantId, branchId, from, to } = extractParams(req);
    const itemId = req.query.itemId ? Number(req.query.itemId) : undefined;
    const categoryId = req.query.categoryId
      ? Number(req.query.categoryId)
      : undefined;
    const data = await getHourlyHeatmapService(
      restaurantId,
      branchId,
      from,
      to,
      itemId,
      categoryId,
    );
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const getCustomerRFM = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
    const data = await getCustomerRFMService(restaurantId, branchId);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const getStaffProductivity = async (req: Request, res: Response) => {
  try {
    const { restaurantId, branchId, from, to } = extractParams(req);
    const data = await getStaffProductivityService(restaurantId, branchId, from, to);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const getRevenueForecast = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
    const data = await getRevenueForecastService(restaurantId, branchId);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const getMenuEngineering = async (req: Request, res: Response) => {
  try {
    const { restaurantId, branchId, from, to } = extractParams(req);
    const data = await getMenuEngineeringService(restaurantId, branchId, from, to);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};
