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
    const data = await updateBranchesService(req.body);

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
    const { restaurantId, ...data } = req.body;
    if (!restaurantId) {
      return res.status(400).json({ success: false, message: "restaurantId is required" });
    }
    const branch = await createBranchService(Number(restaurantId), data);
    return res.status(201).json({ success: true, data: branch });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};
