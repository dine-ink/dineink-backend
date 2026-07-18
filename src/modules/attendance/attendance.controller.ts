import { Request, Response } from "express";
import {
  getAttendanceByBranchService,
  getMonthlyAttendanceService,
  upsertManualAttendanceService,
} from "./attendance.service";

export const getAttendanceByBranch = async (req: Request, res: Response) => {
  try {
    const branchId = Number(req.params.branchId);
    const date = req.query.date as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const data = await getAttendanceByBranchService(branchId, date, from, to);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const getMonthlyAttendance = async (req: Request, res: Response) => {
  try {
    const branchId = Number(req.params.branchId);
    const from = req.query.from as string;
    const to = req.query.to as string;

    if (!from || !to) {
      return res.status(400).json({ success: false, message: "from and to dates are required" });
    }

    const data = await getMonthlyAttendanceService(branchId, from, to);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const upsertManualAttendance = async (req: Request, res: Response) => {
  try {
    const { userId, restaurantId, branchId, date, manualTotalHours, overtimeHours, status } = req.body;
    const data = await upsertManualAttendanceService({
      userId: Number(userId),
      restaurantId: Number(restaurantId),
      branchId: Number(branchId),
      date,
      manualTotalHours,
      overtimeHours,
      status,
    });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};
