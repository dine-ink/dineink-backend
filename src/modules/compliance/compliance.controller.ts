import { Request, Response } from "express";
import {
  getComplianceRecordsService,
  createComplianceRecordService,
  updateComplianceRecordService,
  deleteComplianceRecordService,
  getComplianceSummaryService,
} from "./compliance.service";
import { ForbiddenError } from "./compliance.validation";

const handleError = (error: any, res: Response, message: string) => {
  console.log(error);
  if (error instanceof ForbiddenError) {
    return res.status(403).json({ success: false, message: error.message });
  }
  return res.status(500).json({ success: false, message: error.message || message });
};

export const getComplianceRecords = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const data = await getComplianceRecordsService(restaurantId, branchId);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to fetch compliance records");
  }
};

export const getComplianceSummary = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const data = await getComplianceSummaryService(restaurantId, branchId);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to fetch compliance summary");
  }
};

export const createComplianceRecord = async (req: any, res: Response) => {
  try {
    const data = await createComplianceRecordService(Number(req.user.restaurantId), req.body);
    return res.status(201).json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to create compliance record");
  }
};

export const updateComplianceRecord = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    const data = await updateComplianceRecordService(Number(req.user.restaurantId), id, req.body);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to update compliance record");
  }
};

export const deleteComplianceRecord = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    await deleteComplianceRecordService(Number(req.user.restaurantId), id);
    return res.json({ success: true });
  } catch (err: any) {
    return handleError(err, res, "Failed to delete compliance record");
  }
};

// Mirrors the /uploads/<filename> URL convention used by the restaurant
// module's logo upload (see updateRestaurantLogo in restaurant.controller.ts) —
// the file has already been written to disk by the `uploadDocument` multer
// middleware by the time this controller runs.
export const uploadComplianceDocument = async (req: any, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }
    const documentUrl = `/uploads/${req.file.filename}`;
    return res.status(200).json({ success: true, data: { documentUrl } });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
