import { Response } from "express";
import {
  getEmiSchedulesService,
  createEmiScheduleService,
  updateEmiScheduleService,
  deleteEmiScheduleService,
} from "./emi.service";
import { ForbiddenError } from "./emi.validation";

const handleError = (error: any, res: Response, message: string) => {
  console.log(error);
  if (error instanceof ForbiddenError) {
    return res.status(403).json({ success: false, message: error.message });
  }
  return res.status(500).json({ success: false, message: error.message || message });
};

export const getEmiSchedules = async (req: any, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = req.query.branchId !== undefined ? Number(req.query.branchId) : undefined;
    const data = await getEmiSchedulesService(restaurantId, branchId);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to fetch EMI schedules");
  }
};

export const createEmiSchedule = async (req: any, res: Response) => {
  try {
    const data = await createEmiScheduleService(Number(req.user.restaurantId), {
      ...req.body,
      createdById: req.user.id,
    });
    return res.status(201).json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to create EMI schedule");
  }
};

export const updateEmiSchedule = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    const data = await updateEmiScheduleService(Number(req.user.restaurantId), id, req.body);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to update EMI schedule");
  }
};

export const deleteEmiSchedule = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    await deleteEmiScheduleService(Number(req.user.restaurantId), id);
    return res.json({ success: true });
  } catch (err: any) {
    return handleError(err, res, "Failed to delete EMI schedule");
  }
};
