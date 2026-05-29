import { Request, Response } from "express";
import {
  saveRunningOrderService,
  getRunningOrderByTableService,
  closeRunningOrderService,
  getAllRunningOrdersService,
  updateRunningOrderStatusService,
} from "./runningOrder.service";

export const saveRunningOrder = async (req: Request, res: Response) => {
  try {
    const response = await saveRunningOrderService(req.body);
    return res.status(201).json({ success: true, data: response });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const getRunningOrderByTable = async (req: Request, res: Response) => {
  try {
    const tableId = Number(req.params.tableId);
    const response = await getRunningOrderByTableService(tableId);
    return res.status(200).json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const closeRunningOrder = async (req: Request, res: Response) => {
  try {
    const response = await closeRunningOrderService(req.body);
    return res.status(200).json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const getAllRunningOrders = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const response = await getAllRunningOrdersService(restaurantId, branchId);
    return res.status(200).json({ success: true, data: response });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const updateRunningOrderStatus = async (req: Request, res: Response) => {
  try {
    const orderId = Number(req.params.orderId);
    const { status } = req.body;
    const response = await updateRunningOrderStatusService(orderId, status);
    return res.status(200).json({ success: true, data: response });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};
