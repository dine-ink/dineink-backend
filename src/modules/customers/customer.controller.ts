import { Request, Response } from "express";

import {
  getCustomersByBranchService,
  getCustomersByRestaurantService,
  lookupCustomerByPhoneService,
} from "./customer.service";

export const getCustomersByBranch = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = req.query.branchId ? Number(req.query.branchId) : null;
    const page = req.query.page !== undefined ? Number(req.query.page) : undefined;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    const customers = await getCustomersByBranchService(restaurantId, branchId, page, limit);
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

export const lookupCustomerByPhone = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const phone = String(req.query.phone || "").trim();
    if (!phone) return res.status(200).json({ success: true, data: null });
    const data = await lookupCustomerByPhoneService(restaurantId, phone);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const getCustomersByRestaurant = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.id);
    const page = req.query.page !== undefined ? Number(req.query.page) : undefined;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    // ?includeBills=false for callers that only need the per-customer summary
    // (visits/spend/lastVisit) and not the bill history — the bulk-send
    // audience list, for one, which pulls thousands of rows.
    const includeBills = req.query.includeBills !== "false";
    const customers = await getCustomersByRestaurantService(
      restaurantId,
      page,
      limit,
      { includeBills },
    );
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
