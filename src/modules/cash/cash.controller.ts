import { Request, Response } from "express";
import {
  getCashSessionsService,
  openCashSessionService,
  closeCashSessionService,
  getShiftSalesSummaryService,
} from "./cash.service";
import { ForbiddenError } from "./cash.validation";

const handleError = (error: any, res: Response) => {
  if (error instanceof ForbiddenError) {
    return res.status(403).json({ success: false, message: error.message });
  }
  return res.status(400).json({ success: false, message: error.message });
};

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

export const openCashSession = async (req: any, res: Response) => {
  try {
    const data = await openCashSessionService(Number(req.user.restaurantId), req.body);
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return handleError(error, res);
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

export const closeCashSession = async (req: any, res: Response) => {
  try {
    const sessionId = Number(req.params.id);
    const data = await closeCashSessionService(Number(req.user.restaurantId), sessionId, req.body);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return handleError(error, res);
  }
};
