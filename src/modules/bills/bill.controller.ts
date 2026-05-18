import { Request, Response } from "express";
import {
  createBillService,
  getBillsService,
  getBranchWiseBillsService,
} from "./bill.service";

export const createBill = async (req: Request, res: Response) => {
  try {
    console.log("in bill controller");
    const bill = await createBillService(req.body);
    return res.status(201).json({
      success: true,
      bill,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
      data: req.body,
    });
  }
};

export const getBills = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.id);

    const bills = await getBillsService(restaurantId);
    return res.status(200).json({
      success: true,
      bills,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const getBranchWiseBills = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);

    const bills = await getBranchWiseBillsService(restaurantId, branchId);
    return res.status(200).json({
      success: true,
      bills,
    });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
