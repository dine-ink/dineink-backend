import { Request, Response } from "express";
import {
  getPriceComparisonService,
  getPriceHistoryService,
  ingestSnapshotsService,
  listActiveSuppliersService,
} from "./procurement.service";
import {
  validateDays,
  validateIngestPayload,
  validateSearchTerm,
  ValidationError,
} from "./procurement.validation";

export const getSuppliers = async (_req: Request, res: Response) => {
  try {
    const data = await listActiveSuppliersService();
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    console.log(error);
    return res.status(500).json({ success: false, message: "Failed to fetch suppliers" });
  }
};

export const getPrices = async (req: Request, res: Response) => {
  try {
    const term = validateSearchTerm(req.query.term);
    const city =
      typeof req.query.city === "string" && req.query.city.trim()
        ? req.query.city.trim().toLowerCase()
        : undefined;
    const data = await getPriceComparisonService(term, city);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.log(error);
    return res.status(500).json({ success: false, message: "Failed to fetch prices" });
  }
};

export const getHistory = async (req: Request, res: Response) => {
  try {
    const term = validateSearchTerm(req.query.term);
    const days = validateDays(req.query.days);
    const data = await getPriceHistoryService(term, days);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.log(error);
    return res.status(500).json({ success: false, message: "Failed to fetch price history" });
  }
};

export const ingest = async (req: Request, res: Response) => {
  try {
    const payload = validateIngestPayload(req.body);
    const capturedByRestaurantId = (req as any).user?.restaurantId;
    const data = await ingestSnapshotsService(payload, capturedByRestaurantId);
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.log(error);
    return res.status(500).json({ success: false, message: "Failed to ingest procurement data" });
  }
};
