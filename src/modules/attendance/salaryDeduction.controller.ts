import { Request, Response } from "express";
import {
  getSalaryDeductionsService,
  createSalaryDeductionService,
  updateSalaryDeductionService,
  deleteSalaryDeductionService,
} from "./salaryDeduction.service";
import { ForbiddenError } from "./attendance.validation";

const handleError = (error: any, res: Response) => {
  if (error instanceof ForbiddenError) {
    return res.status(403).json({ success: false, message: error.message });
  }
  return res.status(400).json({ success: false, message: error.message });
};

export const getSalaryDeductions = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const month = req.query.month !== undefined ? Number(req.query.month) : undefined;
    const year = req.query.year !== undefined ? Number(req.query.year) : undefined;
    const data = await getSalaryDeductionsService(restaurantId, branchId, month, year);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const createSalaryDeduction = async (req: any, res: Response) => {
  try {
    const { userId, branchId, deductionType, amount, month, year, notes } = req.body;
    const data = await createSalaryDeductionService(Number(req.user.restaurantId), {
      userId: Number(userId),
      branchId: Number(branchId),
      deductionType,
      amount: Number(amount),
      month: Number(month),
      year: Number(year),
      notes,
      createdById: req.user?.id ? Number(req.user.id) : undefined,
    });
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const updateSalaryDeduction = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { deductionType, amount, notes } = req.body;
    const data = await updateSalaryDeductionService(Number(req.user.restaurantId), id, {
      ...(deductionType !== undefined ? { deductionType } : {}),
      ...(amount !== undefined ? { amount: Number(amount) } : {}),
      ...(notes !== undefined ? { notes } : {}),
    });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const deleteSalaryDeduction = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    await deleteSalaryDeductionService(Number(req.user.restaurantId), id);
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return handleError(error, res);
  }
};
