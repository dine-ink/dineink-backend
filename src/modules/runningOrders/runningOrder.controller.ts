import { Request, Response } from "express";
import {
  saveRunningOrderService,
  getRunningOrderByTableService,
  closeRunningOrderService,
  getAllRunningOrdersService,
  updateRunningOrderStatusService,
  requestItemCancelService,
  approveItemCancelService,
  rejectItemCancelService,
  holdRunningOrderService,
  resumeRunningOrderService,
  discardRunningOrderService,
  transferTableService,
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

export const requestItemCancel = async (req: Request, res: Response) => {
  try {
    await requestItemCancelService(Number(req.params.itemId));
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const approveItemCancel = async (req: Request, res: Response) => {
  try {
    await approveItemCancelService(Number(req.params.itemId));
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const rejectItemCancel = async (req: Request, res: Response) => {
  try {
    await rejectItemCancelService(Number(req.params.itemId));
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const holdRunningOrder = async (req: Request, res: Response) => {
  try {
    const orderId = Number(req.params.orderId);
    const response = await holdRunningOrderService(orderId);
    return res.status(200).json({ success: true, data: response });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const resumeRunningOrder = async (req: Request, res: Response) => {
  try {
    const orderId = Number(req.params.orderId);
    const response = await resumeRunningOrderService(orderId);
    return res.status(200).json({ success: true, data: response });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const transferTable = async (req: Request, res: Response) => {
  try {
    const { fromTableId, toTableId, restaurantId, branchId } = req.body;
    const response = await transferTableService(
      Number(fromTableId),
      Number(toTableId),
      Number(restaurantId),
      Number(branchId),
    );
    return res.status(200).json({ success: true, data: response });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const discardRunningOrder = async (req: Request, res: Response) => {
  try {
    const orderId = Number(req.params.orderId);
    const response = await discardRunningOrderService(orderId);
    return res.status(200).json({ success: true, data: response });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};
