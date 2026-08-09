import { Request, Response } from "express";

import {
  getMenuManagementService,
  saveMenuItemMappingData,
  getMenuItemMappingData,
  saveRestockHistoryData,
  getRestockHistoryData,
  getInventoryAdjustmentsService,
  getIngredientLifecycleService,
  getDailyAuditPreviewService,
  saveDailyAuditService,
  getDailyAuditHistoryService,
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

// GET /api/inventory/daily-audit/preview?branchId=&date=YYYY-MM-DD
export const getDailyAuditPreview = async (req: any, res: Response) => {
  try {
    const restaurantId = req.user.restaurantId;
    const branchId = Number(req.query.branchId);
    const date = req.query.date as string;
    if (!branchId || !date) return res.status(400).json({ success: false, message: "branchId and date are required" });
    const data = await getDailyAuditPreviewService(restaurantId, branchId, date);
    return res.status(200).json({ success: true, data });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/inventory/daily-audit
export const saveDailyAudit = async (req: any, res: Response) => {
  try {
    const restaurantId = req.user.restaurantId;
    const { branchId, date, entries } = req.body;
    if (!branchId || !date || !Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ success: false, message: "branchId, date, and entries are required" });
    }
    const result = await saveDailyAuditService(restaurantId, branchId, date, entries);
    return res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/inventory/daily-audit/history?branchId=&from=&to=
export const getDailyAuditHistory = async (req: any, res: Response) => {
  try {
    const branchId = Number(req.query.branchId);
    const from = req.query.from as string;
    const to = req.query.to as string;
    if (!branchId || !from || !to) return res.status(400).json({ success: false, message: "branchId, from, to are required" });
    const data = await getDailyAuditHistoryService(branchId, from, to);
    return res.status(200).json({ success: true, data });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/inventory/lifecycle?branchId=&month=&year=
export const getLifecycle = async (req: any, res: Response) => {
  try {
    const restaurantId = req.user.restaurantId;
    const branchId = Number(req.query.branchId);
    const month = Number(req.query.month);
    const year = Number(req.query.year);
    if (!branchId || !month || !year) {
      return res.status(400).json({ success: false, message: "branchId, month, year are required" });
    }
    const data = await getIngredientLifecycleService(restaurantId, branchId, month, year);
    return res.status(200).json({ success: true, data });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/inventory/adjustments?branchId=&from=&to=
export const getAdjustments = async (req: any, res: Response) => {
  try {
    const restaurantId = req.user.restaurantId;
    const branchId = Number(req.query.branchId);
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    if (!branchId) {
      return res.status(400).json({ success: false, message: "branchId is required" });
    }

    const data = await getInventoryAdjustmentsService(restaurantId, branchId, from, to);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};
