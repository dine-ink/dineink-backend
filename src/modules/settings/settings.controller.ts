import { Request, Response } from "express";

import {
  getRestaurantSettingsService,
  updateBranchesService,
  updateGeneralSettingsService,
  createBranchService,
} from "./settings.service";

export const getRestaurantSettings = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);

    const data = await getRestaurantSettingsService(restaurantId);

    return res.status(200).json({
      success: true,

      data,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,

      message: error.message,
    });
  }
};

export const updateBranches = async (req: Request, res: Response) => {
  try {
    // Ignore whatever restaurantId the client sent — use the caller's own,
    // and updateBranchesService verifies every branch.id in the payload
    // actually belongs to it before writing anything.
    const data = await updateBranchesService({
      ...req.body,
      restaurantId: (req as any).user.restaurantId,
    });

    return res.status(200).json({
      success: true,

      data,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,

      message: error.message,
    });
  }
};

export const updateGeneralSettings = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.id);
    const data = await updateGeneralSettingsService(restaurantId, req.body);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const createBranch = async (req: Request, res: Response) => {
  try {
    // Always the caller's own restaurant — never a client-supplied id.
    const branch = await createBranchService((req as any).user.restaurantId, req.body);
    return res.status(201).json({ success: true, data: branch });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};
