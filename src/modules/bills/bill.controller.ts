import { Request, Response } from "express";
import {
  createBillService,
  getBillsService,
  getBranchWiseBillsService,
  getReportBillsService,
  cancelBillService,
  createBillRefundService,
  getBillRefundsService,
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
    const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
    const bills = await getBillsService(restaurantId, branchId);
    return res.status(200).json({ success: true, bills });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

// Raw bills with all financial fields for Reports/P&L page
export const getReportBills = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const bills = await getReportBillsService(restaurantId, branchId, from, to);
    return res.status(200).json({ success: true, bills });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const getBranchWiseBills = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    console.log(restaurantId, branchId, "ids");
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

export const cancelBill = async (req: Request, res: Response) => {
  try {
    const billId = Number(req.params.billId);
    const bill = await cancelBillService(billId, (req as any).user.restaurantId);
    return res.status(200).json({ success: true, bill });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const createBillRefund = async (req: Request, res: Response) => {
  try {
    const billId = Number(req.params.billId);
    const { amount, reason, createdById } = req.body;
    const bill = await createBillRefundService(
      billId,
      Number(amount),
      reason,
      createdById ? Number(createdById) : undefined,
      (req as any).user.restaurantId,
    );
    return res.status(200).json({ success: true, bill });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const getBillRefunds = async (req: Request, res: Response) => {
  try {
    const billId = Number(req.params.billId);
    const refunds = await getBillRefundsService(billId, (req as any).user.restaurantId);
    return res.status(200).json({ success: true, data: refunds });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};
