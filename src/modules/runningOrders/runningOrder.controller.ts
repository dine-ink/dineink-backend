import { Request, Response } from "express";
import {
  saveRunningOrderService,
  getRunningOrderByTableService,
  closeRunningOrderService,
} from "./runningOrder.service";

export const saveRunningOrder = async (req: Request, res: Response) => {
  try {
    const response = await saveRunningOrderService(req.body);
    return res.status(201).json({ success: true, data: response });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const getRunningOrderByTable = async (req: Request, res: Response) => {
  try {
    const tableId = Number(req.params.tableId);
    const response = await getRunningOrderByTableService(tableId);
    return res.status(200).json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const closeRunningOrder = async (req: Request, res: Response) => {
  try {
    const response = await closeRunningOrderService(req.body);
    return res.status(200).json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
