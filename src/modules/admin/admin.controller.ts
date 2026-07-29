import { Request, Response } from "express";

import {
  getTodayAttendanceService,
  loginAttendanceService,
  logoutAttendanceService,
  createExpenseService,
  deleteExpenseService,
  getExpensesService,
  getExpenseUsersService,
  updateExpenseService,
  getInventoryAdjustmentsService,
  getInventoryIngredientsService,
  getInventoryUsersService,
  createInventoryAdjustmentService,
  updateInventoryAdjustmentService,
  deleteInventoryAdjustmentService,
} from "./admin.service";
import { ForbiddenError } from "./admin.validation";

const handleError = (error: any, res: Response, fallbackStatus = 400) => {
  console.log(error);
  if (error instanceof ForbiddenError) {
    return res.status(403).json({ success: false, message: error.message });
  }
  return res.status(fallbackStatus).json({ success: false, message: error.message });
};

export const getTodayAttendance = async (req: Request, res: Response) => {
  try {
    const branchId = Number(req.params.branchId);

    const data = await getTodayAttendanceService(branchId);

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

export const loginAttendance = async (req: any, res: Response) => {
  try {
    const data = await loginAttendanceService(Number(req.user.restaurantId), req.body);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const logoutAttendance = async (req: any, res: Response) => {
  try {
    const attendanceId = Number(req.body.attendanceId);

    const data = await logoutAttendanceService(Number(req.user.restaurantId), attendanceId);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const getExpenses = async (req: Request, res: Response) => {
  try {
    const branchId = Number(req.params.branchId);

    const data = await getExpensesService(branchId);

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

export const getExpenseUsers = async (req: Request, res: Response) => {
  try {
    const branchId = Number(req.params.branchId);

    const data = await getExpenseUsersService(branchId);

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

export const createExpense = async (req: any, res: Response) => {
  try {
    const data = await createExpenseService(Number(req.user.restaurantId), req.body);

    return res.status(201).json({
      success: true,
      data,
    });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const updateExpense = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);

    const data = await updateExpenseService(Number(req.user.restaurantId), id, req.body);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const deleteExpense = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);

    await deleteExpenseService(Number(req.user.restaurantId), id);

    return res.status(200).json({
      success: true,
      message: "Expense deleted successfully",
    });
  } catch (error: any) {
    return handleError(error, res);
  }
};
export const getInventoryAdjustments = async (req: Request, res: Response) => {
  try {
    const branchId = Number(req.params.branchId);

    const data = await getInventoryAdjustmentsService(branchId);

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
export const getInventoryIngredients = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);

    const data = await getInventoryIngredientsService(restaurantId);

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
export const getInventoryUsers = async (req: Request, res: Response) => {
  try {
    const branchId = Number(req.params.branchId);

    const data = await getInventoryUsersService(branchId);

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
export const createInventoryAdjustment = async (
  req: any,
  res: Response,
) => {
  try {
    const data = await createInventoryAdjustmentService(Number(req.user.restaurantId), req.body);

    return res.status(201).json({
      success: true,
      data,
    });
  } catch (error: any) {
    return handleError(error, res);
  }
};
export const updateInventoryAdjustment = async (
  req: any,
  res: Response,
) => {
  try {
    const id = Number(req.params.id);

    const data = await updateInventoryAdjustmentService(Number(req.user.restaurantId), id, req.body);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    return handleError(error, res);
  }
};
export const deleteInventoryAdjustment = async (
  req: any,
  res: Response,
) => {
  try {
    const id = Number(req.params.id);

    await deleteInventoryAdjustmentService(Number(req.user.restaurantId), id);

    return res.status(200).json({
      success: true,
      message: "Inventory adjustment deleted",
    });
  } catch (error: any) {
    return handleError(error, res);
  }
};
