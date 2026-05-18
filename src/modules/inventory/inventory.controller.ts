import { Request, Response } from "express";

import {
  getMenuManagementService,
  saveMenuItemMappingData,
  getMenuItemMappingData,
  saveRestockHistoryData,
  getRestockHistoryData,
} from "./inventory.service";

export const getMenuManagement = async (req: any, res: any) => {
  try {
    const restaurantId = Number(req.params.restaurantId);

    const data = await getMenuManagementService(restaurantId);

    return res.json({
      success: true,
      data,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

export const saveMenuItemMapping = async (req: Request, res: Response) => {
  try {
    const data = await saveMenuItemMappingData(req.body);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err: any) {
    console.log(err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

export const getMenuItemMapping = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);

    const data = await getMenuItemMappingData(restaurantId);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err: any) {
    console.log(err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

export const saveRestockHistory = async (req: Request, res: Response) => {
  try {
    const { restaurantId, month, year, data } = req.body;

    const result = await saveRestockHistoryData(
      restaurantId,
      month,
      year,
      data,
    );

    return res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.log(err);

    return res.status(500).json({
      success: false,
      message: "Failed to save restock history",
    });
  }
};

export const getRestockHistory = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);

    const result = await getRestockHistoryData(restaurantId);

    return res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.log(err);

    return res.status(500).json({
      success: false,
    });
  }
};
