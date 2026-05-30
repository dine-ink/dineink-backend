import { Request, Response } from "express";
import { getExpensesReportService } from "./reports.service";

export const getExpensesReport = async (req: Request, res: Response) => {
  try {
    const branchId = Number(req.query.branchId);
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    if (!branchId) {
      return res.status(400).json({ success: false, message: "branchId is required" });
    }

    const data = await getExpensesReportService(branchId, from, to);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};
