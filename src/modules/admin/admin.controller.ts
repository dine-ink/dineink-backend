import { Request, Response } from "express";

import {
  getTodayAttendanceService,
  loginAttendanceService,
  logoutAttendanceService,
  startBreakService,
  endBreakService,
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

export const loginAttendance = async (req: Request, res: Response) => {
  try {
    const data = await loginAttendanceService(req.body);

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

export const logoutAttendance = async (req: Request, res: Response) => {
  try {
    const attendanceId = Number(req.body.attendanceId);

    const data = await logoutAttendanceService(attendanceId);

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

export const startBreak = async (req: Request, res: Response) => {
  try {
    const attendanceId = Number(req.body.attendanceId);

    const data = await startBreakService(attendanceId);

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

export const endBreak = async (req: Request, res: Response) => {
  try {
    const attendanceId = Number(req.body.attendanceId);

    const data = await endBreakService(attendanceId);

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

export const createExpense = async (req: Request, res: Response) => {
  try {
    const data = await createExpenseService(req.body);

    return res.status(201).json({
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

export const updateExpense = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const data = await updateExpenseService(id, req.body);

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

export const deleteExpense = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    await deleteExpenseService(id);

    return res.status(200).json({
      success: true,
      message: "Expense deleted successfully",
    });
  } catch (error: any) {
    console.log(error);

    return res.status(400).json({
      success: false,
      message: error.message,
    });
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
  req: Request,
  res: Response,
) => {
  try {
    const data = await createInventoryAdjustmentService(req.body);

    return res.status(201).json({
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
export const updateInventoryAdjustment = async (
  req: Request,
  res: Response,
) => {
  try {
    const id = Number(req.params.id);

    const data = await updateInventoryAdjustmentService(id, req.body);

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
export const deleteInventoryAdjustment = async (
  req: Request,
  res: Response,
) => {
  try {
    const id = Number(req.params.id);

    await deleteInventoryAdjustmentService(id);

    return res.status(200).json({
      success: true,
      message: "Inventory adjustment deleted",
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
