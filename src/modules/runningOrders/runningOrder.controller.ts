import { Response } from "express";
import {
  saveRunningOrderService,
  getRunningOrderByTableService,
  closeRunningOrderService,
  getAllRunningOrdersService,
  updateRunningOrderStatusService,
  requestItemCancelService,
  approveItemCancelService,
  rejectItemCancelService,
  toggleItemDoneService,
  holdRunningOrderService,
  resumeRunningOrderService,
  discardRunningOrderService,
  transferTableService,
} from "./runningOrder.service";
import { ForbiddenError } from "./runningOrder.validation";

const handleError = (error: any, res: Response) => {
  if (error instanceof ForbiddenError) {
    return res.status(403).json({ success: false, message: error.message });
  }
  return res.status(400).json({ success: false, message: error.message });
};

export const saveRunningOrder = async (req: any, res: Response) => {
  try {
    const response = await saveRunningOrderService(Number(req.user.restaurantId), req.body);
    return res.status(201).json({ success: true, data: response });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const getRunningOrderByTable = async (req: any, res: Response) => {
  try {
    const tableId = Number(req.params.tableId);
    const response = await getRunningOrderByTableService(Number(req.user.restaurantId), tableId);
    return res.status(200).json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const closeRunningOrder = async (req: any, res: Response) => {
  try {
    const response = await closeRunningOrderService(Number(req.user.restaurantId), req.body);
    return res.status(200).json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const getAllRunningOrders = async (req: any, res: Response) => {
  try {
    // Already ownership-checked at the route level via requireOwnRestaurant().
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const response = await getAllRunningOrdersService(restaurantId, branchId);
    return res.status(200).json({ success: true, data: response });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const updateRunningOrderStatus = async (req: any, res: Response) => {
  try {
    const orderId = Number(req.params.orderId);
    const { status } = req.body;
    const response = await updateRunningOrderStatusService(Number(req.user.restaurantId), orderId, status);
    return res.status(200).json({ success: true, data: response });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const requestItemCancel = async (req: any, res: Response) => {
  try {
    await requestItemCancelService(Number(req.user.restaurantId), Number(req.params.itemId));
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const approveItemCancel = async (req: any, res: Response) => {
  try {
    await approveItemCancelService(Number(req.user.restaurantId), Number(req.params.itemId));
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const rejectItemCancel = async (req: any, res: Response) => {
  try {
    await rejectItemCancelService(Number(req.user.restaurantId), Number(req.params.itemId));
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const toggleItemDone = async (req: any, res: Response) => {
  try {
    const itemId = Number(req.params.itemId);
    const { done } = req.body;
    const response = await toggleItemDoneService(Number(req.user.restaurantId), itemId, !!done);
    return res.status(200).json({ success: true, data: response });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const holdRunningOrder = async (req: any, res: Response) => {
  try {
    const orderId = Number(req.params.orderId);
    const response = await holdRunningOrderService(Number(req.user.restaurantId), orderId);
    return res.status(200).json({ success: true, data: response });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const resumeRunningOrder = async (req: any, res: Response) => {
  try {
    const orderId = Number(req.params.orderId);
    const response = await resumeRunningOrderService(Number(req.user.restaurantId), orderId);
    return res.status(200).json({ success: true, data: response });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const transferTable = async (req: any, res: Response) => {
  try {
    const { fromTableId, toTableId, branchId } = req.body;
    // Never trust a client-supplied restaurantId — force the caller's own.
    const response = await transferTableService(
      Number(fromTableId),
      Number(toTableId),
      Number(req.user.restaurantId),
      Number(branchId),
    );
    return res.status(200).json({ success: true, data: response });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const discardRunningOrder = async (req: any, res: Response) => {
  try {
    const orderId = Number(req.params.orderId);
    const response = await discardRunningOrderService(Number(req.user.restaurantId), orderId);
    return res.status(200).json({ success: true, data: response });
  } catch (error: any) {
    return handleError(error, res);
  }
};
