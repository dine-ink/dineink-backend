import { Request, Response } from "express";

import {
  getCustomersByBranchService,
  getCustomersByRestaurantService,
} from "./customer.service";

export const getCustomersByBranch = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = req.query.branchId ? Number(req.query.branchId) : null;
    const customers = await getCustomersByBranchService(restaurantId, branchId);
    return res.status(200).json({
      success: true,
      customers,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const getCustomersByRestaurant = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.id);
    const customers = await getCustomersByRestaurantService(restaurantId);
    return res.status(200).json({
      success: true,
      customers,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
