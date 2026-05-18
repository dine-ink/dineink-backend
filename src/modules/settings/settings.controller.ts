import { Request, Response } from "express";

import {
  getRestaurantSettingsService,
  updateBranchesService,
  updateGeneralSettingsService,
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
