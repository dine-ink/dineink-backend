import { Request, Response } from "express";
import {
  getCashSessionsService,
  openCashSessionService,
  closeCashSessionService,
  getShiftSalesSummaryService,
} from "./cash.service";

export const getCashSessions = async (req: Request, res: Response) => {
  try {
    const branchId = Number(req.query.branchId);
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    if (!branchId) {
      return res.status(400).json({ success: false, message: "branchId is required" });
    }

    const data = await getCashSessionsService(branchId, from, to);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const openCashSession = async (req: Request, res: Response) => {
  try {
    const data = await openCashSessionService(req.body);
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const getShiftSalesSummary = async (req: Request, res: Response) => {
  try {
    const sessionId = Number(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({ success: false, message: "sessionId is required" });
    }

    const data = await getShiftSalesSummaryService(sessionId);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const closeCashSession = async (req: Request, res: Response) => {
  try {
    const sessionId = Number(req.params.id);
    const data = await closeCashSessionService(sessionId, req.body);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};
