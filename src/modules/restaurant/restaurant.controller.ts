import { Request, Response } from "express";

import {
  setupRestaurantService,
  getShopsService,
  getMyRestaurantService,
  getBranchDetailsService,
  updateBranchDetailsService,
  getRestaurantStaffData,
  getTablesService,
} from "./restaurant.service";

export const setupRestaurant = async (req: any, res: Response) => {
  try {
    const userId = req.user.id;

    // PARSE JSON STRING

    const body = JSON.parse(req.body.data);

    // ATTACH LOGO

    if (req.file) {
      body.restaurant.logo = `/uploads/${req.file.filename}`;
    }

    const data = await setupRestaurantService(userId, body);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.log(error.stack);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getShops = async (req: any, res: Response) => {
  try {
    const userId = req.user.id;
    const data = await getShopsService(userId);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getMyRestaurant = async (req: any, res: Response) => {
  try {
    const userId = req.user.id;
    const data = await getMyRestaurantService(userId);
    console.log(data, "data");
    return res.status(200).json({
      success: true,

      data,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getBranchDetails = async (req: Request, res: Response) => {
  try {
    const branchId = Number(req.params.id);
    const data = await getBranchDetailsService(branchId);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const updateBranchDetails = async (req: Request, res: Response) => {
  try {
    const branchId = Number(req.params.id);
    const data = await updateBranchDetailsService(branchId, req.body);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getRestaurantStaff = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);

    const data = await getRestaurantStaffData(restaurantId, branchId);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getTablesController = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const data = await getTablesService(restaurantId, branchId);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
