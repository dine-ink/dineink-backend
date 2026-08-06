import { Request, Response } from "express";
import { runPayrollService, getPayrollRunsService } from "./payroll.service";
import { ForbiddenError } from "./attendance.validation";

const handleError = (error: any, res: Response) => {
  if (error instanceof ForbiddenError) {
    return res.status(403).json({ success: false, message: error.message });
  }
  return res.status(400).json({ success: false, message: error.message });
};

export const runPayroll = async (req: any, res: Response) => {
  try {
    const { branchId, month, year } = req.body;
    const data = await runPayrollService(
      Number(req.user.restaurantId),
      Number(branchId),
      Number(month),
      Number(year),
      req.user?.id ? Number(req.user.id) : undefined,
    );
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const getPayrollRuns = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const data = await getPayrollRunsService(restaurantId, branchId);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return handleError(error, res);
  }
};
