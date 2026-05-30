import { Request, Response } from "express";

import {
  getMenuManagementService,
  saveMenuItemMappingData,
  getMenuItemMappingData,
  saveRestockHistoryData,
  getRestockHistoryData,
  getInventoryAdjustmentsService,
} from "./inventory.service";

export const getMenuManagement = async (req: any, res: any) => {
  try {
    const restaurantId = Number(req.params.restaurantId);

    const branchId = Number(req.query.branchId);

    const data = await getMenuManagementService(restaurantId, branchId);

    return res.json({
      success: true,
      data,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

export const saveMenuItemMapping = async (req: any, res: Response) => {
  try {
    const restaurantId = req.user.restaurantId;

    const data = await saveMenuItemMappingData(restaurantId, req.body);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

export const getMenuItemMapping = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);

    const data = await getMenuItemMappingData(restaurantId);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err: any) {
    console.log(err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

export const saveRestockHistory = async (req: Request, res: Response) => {
  try {
    const { restaurantId, branchId, month, year, data } = req.body;

    const result = await saveRestockHistoryData(
      restaurantId,
      branchId,
      month,
      year,
      data,
    );

    return res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.log(err);

    return res.status(500).json({
      success: false,
      message: "Failed to save restock history",
    });
  }
};

export const getRestockHistory = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.query.branchId);
    const result = await getRestockHistoryData(restaurantId, branchId);
    return res.json({ success: true, data: result });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false });
  }
};

// GET /api/inventory/adjustments?branchId=&from=&to=
export const getAdjustments = async (req: Request, res: Response) => {
  try {
    const branchId = Number(req.query.branchId);
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    if (!branchId) {
      return res.status(400).json({ success: false, message: "branchId is required" });
    }

    const data = await getInventoryAdjustmentsService(branchId, from, to);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};
