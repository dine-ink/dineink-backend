import { Response } from "express";
import {
  getEquipmentListService,
  createEquipmentService,
  updateEquipmentService,
  deleteEquipmentService,
  getMaintenanceDueService,
} from "./equipment.service";
import { ForbiddenError } from "./equipment.validation";

const handleError = (error: any, res: Response, message: string) => {
  console.log(error);
  if (error instanceof ForbiddenError) {
    return res.status(403).json({ success: false, message: error.message });
  }
  return res.status(500).json({ success: false, message: error.message || message });
};

export const getEquipmentList = async (req: any, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const data = await getEquipmentListService(restaurantId, branchId);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to fetch equipment");
  }
};

export const createEquipment = async (req: any, res: Response) => {
  try {
    const data = await createEquipmentService(Number(req.user.restaurantId), {
      ...req.body,
      createdById: req.user.id,
    });
    return res.status(201).json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to create equipment");
  }
};

export const updateEquipment = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    const data = await updateEquipmentService(Number(req.user.restaurantId), id, req.body);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to update equipment");
  }
};

export const deleteEquipment = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    await deleteEquipmentService(Number(req.user.restaurantId), id);
    return res.json({ success: true });
  } catch (err: any) {
    return handleError(err, res, "Failed to delete equipment");
  }
};

export const getMaintenanceDue = async (req: any, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const withinDays = req.query.withinDays ? Number(req.query.withinDays) : undefined;
    const data = await getMaintenanceDueService(restaurantId, branchId, withinDays);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to fetch maintenance due list");
  }
};
