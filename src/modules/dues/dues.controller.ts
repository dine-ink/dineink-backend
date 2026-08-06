import { Response } from "express";
import {
  getMonthlyDuesService,
  createMonthlyDueService,
  updateMonthlyDueService,
  deleteMonthlyDueService,
  getPaymentCalendarService,
  getMonthComparisonService,
  getEbitdaSummaryService,
} from "./dues.service";
import { ForbiddenError } from "./dues.validation";

const handleError = (error: any, res: Response, message: string) => {
  console.log(error);
  if (error instanceof ForbiddenError) {
    return res.status(403).json({ success: false, message: error.message });
  }
  return res.status(500).json({ success: false, message: error.message || message });
};

export const getMonthlyDues = async (req: any, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const month = req.query.month !== undefined ? Number(req.query.month) : undefined;
    const year = req.query.year !== undefined ? Number(req.query.year) : undefined;
    const data = await getMonthlyDuesService(restaurantId, branchId, month, year);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to fetch monthly dues");
  }
};

export const createMonthlyDue = async (req: any, res: Response) => {
  try {
    const data = await createMonthlyDueService(Number(req.user.restaurantId), {
      ...req.body,
      createdById: req.user.id,
    });
    return res.status(201).json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to create monthly due");
  }
};

export const updateMonthlyDue = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    const data = await updateMonthlyDueService(Number(req.user.restaurantId), id, req.body);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to update monthly due");
  }
};

export const deleteMonthlyDue = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    await deleteMonthlyDueService(Number(req.user.restaurantId), id);
    return res.json({ success: true });
  } catch (err: any) {
    return handleError(err, res, "Failed to delete monthly due");
  }
};

export const getPaymentCalendar = async (req: any, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    if (!from || !to) {
      return res.status(400).json({ success: false, message: "from and to query params are required" });
    }
    const data = await getPaymentCalendarService(restaurantId, branchId, new Date(from), new Date(to));
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to fetch payment calendar");
  }
};

export const getMonthComparison = async (req: any, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const now = new Date();
    const month = req.query.month !== undefined ? Number(req.query.month) : now.getMonth() + 1;
    const year = req.query.year !== undefined ? Number(req.query.year) : now.getFullYear();
    const data = await getMonthComparisonService(restaurantId, branchId, month, year);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to fetch month comparison");
  }
};

export const getEbitdaSummary = async (req: any, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const now = new Date();
    const month = req.query.month !== undefined ? Number(req.query.month) : now.getMonth() + 1;
    const year = req.query.year !== undefined ? Number(req.query.year) : now.getFullYear();
    const data = await getEbitdaSummaryService(restaurantId, branchId, month, year);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to fetch EBITDA summary");
  }
};
