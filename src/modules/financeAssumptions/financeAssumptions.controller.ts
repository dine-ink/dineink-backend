import { Request, Response } from "express";
import {
  getRestaurantDefaultsService,
  getResolvedAssumptionsService,
  upsertBranchOverridesService,
  upsertRestaurantDefaultsService,
} from "./financeAssumptions.service";
import {
  ValidationError,
  validateAssumptionUpdatePayload,
  validateBranchId,
  validateRestaurantId,
} from "./financeAssumptions.validation";

export const getRestaurantDefaults = async (req: Request, res: Response) => {
  try {
    const restaurantId = validateRestaurantId(req.params.restaurantId);
    const data = await getRestaurantDefaultsService(restaurantId);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.log(error);
    return res.status(500).json({ success: false, message: "Failed to fetch financial assumptions" });
  }
};

export const getResolvedAssumptions = async (req: Request, res: Response) => {
  try {
    const restaurantId = validateRestaurantId(req.params.restaurantId);
    const branchId = validateBranchId(req.params.branchId);
    const data = await getResolvedAssumptionsService(restaurantId, branchId);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.log(error);
    return res.status(500).json({ success: false, message: "Failed to fetch financial assumptions" });
  }
};

export const updateRestaurantDefaults = async (req: Request, res: Response) => {
  try {
    const restaurantId = validateRestaurantId(req.params.restaurantId);
    const payload = validateAssumptionUpdatePayload(req.body);
    const updatedById = (req as any).user?.id;
    const data = await upsertRestaurantDefaultsService(restaurantId, payload, updatedById);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.log(error);
    return res.status(500).json({ success: false, message: "Failed to update financial assumptions" });
  }
};

export const updateBranchOverrides = async (req: Request, res: Response) => {
  try {
    const restaurantId = validateRestaurantId(req.params.restaurantId);
    const branchId = validateBranchId(req.params.branchId);
    const payload = validateAssumptionUpdatePayload(req.body);
    const updatedById = (req as any).user?.id;
    const data = await upsertBranchOverridesService(restaurantId, branchId, payload, updatedById);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.log(error);
    return res.status(500).json({ success: false, message: "Failed to update financial assumptions" });
  }
};
