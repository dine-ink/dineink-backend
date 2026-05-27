import { Request, Response } from "express";

import {
  getBranchInsightsData,
  getDashboardOverviewDataService,
  getDashboardOverviewService,
  getRestaurantInsightsData,
  saveRestaurantInsightsData,
} from "./analytics.service";

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
