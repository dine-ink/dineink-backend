import { Response } from "express";
import { getCashFlowProjectionService, getDailyCashInflowService, CashFlowHorizon } from "./cashflow.service";
import { ForbiddenError } from "./cashflow.validation";

// Mirrors emi.controller.ts's handleError convention exactly, so this
// module's error shape is consistent with the other financially sensitive
// modules it sits alongside.
const handleError = (error: any, res: Response, message: string) => {
  console.log(error);
  if (error instanceof ForbiddenError) {
    return res.status(403).json({ success: false, message: error.message });
  }
  return res.status(500).json({ success: false, message: error.message || message });
};

const VALID_HORIZONS: CashFlowHorizon[] = ["week", "month", "quarter"];

const parseHorizon = (value: unknown): CashFlowHorizon => {
  if (typeof value === "string" && (VALID_HORIZONS as string[]).includes(value)) return value as CashFlowHorizon;
  return "month";
};

export const getCashFlowProjection = async (req: any, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const horizon = parseHorizon(req.query.horizon);
    const data = await getCashFlowProjectionService(restaurantId, branchId, horizon);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to compute cash flow projection");
  }
};

export const getDailyCashInflow = async (req: any, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    if (!from || !to) {
      return res.status(400).json({ success: false, message: "'from' and 'to' query params are required" });
    }
    const data = await getDailyCashInflowService(restaurantId, branchId, from, to);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to fetch daily cash inflow");
  }
};
