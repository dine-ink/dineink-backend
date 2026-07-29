import { Request, Response } from "express";
import {
  getVendorPaymentsService,
  createVendorPaymentService,
  deleteVendorPaymentService,
  getVendorInvoicesService,
  createVendorInvoiceService,
  payVendorInvoiceService,
  deleteVendorInvoiceService,
  getVendorOutstandingService,
  getVendorPerformanceService,
  getVendorInvoiceActivityService,
} from "./vendor.service";
import { ForbiddenError } from "./vendor.validation";

const handleError = (error: any, res: Response, message: string) => {
  console.log(error);
  if (error instanceof ForbiddenError) {
    return res.status(403).json({ success: false, message: error.message });
  }
  return res.status(500).json({ success: false, message: error.message || message });
};

export const getVendorPayments = async (req: Request, res: Response) => {
  try {
    const vendorId = Number(req.params.vendorId);
    const data = await getVendorPaymentsService(vendorId);
    return res.json({ success: true, data });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Failed to fetch payments" });
  }
};

export const createVendorPayment = async (req: any, res: Response) => {
  try {
    const data = await createVendorPaymentService(Number(req.user.restaurantId), req.body);
    return res.status(201).json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to record payment");
  }
};

export const deleteVendorPayment = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    await deleteVendorPaymentService(Number(req.user.restaurantId), id);
    return res.json({ success: true });
  } catch (err: any) {
    return handleError(err, res, "Failed to delete payment");
  }
};

export const getVendorInvoices = async (req: Request, res: Response) => {
  try {
    const vendorId = Number(req.params.vendorId);
    const data = await getVendorInvoicesService(vendorId);
    return res.json({ success: true, data });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Failed to fetch invoices" });
  }
};

export const createVendorInvoice = async (req: any, res: Response) => {
  try {
    const data = await createVendorInvoiceService(Number(req.user.restaurantId), req.body);
    return res.status(201).json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to create invoice");
  }
};

export const payVendorInvoice = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { amount } = req.body;
    const data = await payVendorInvoiceService(Number(req.user.restaurantId), id, Number(amount));
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to update invoice");
  }
};

export const deleteVendorInvoice = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    await deleteVendorInvoiceService(Number(req.user.restaurantId), id);
    return res.json({ success: true });
  } catch (err: any) {
    return handleError(err, res, "Failed to delete invoice");
  }
};

export const getVendorOutstanding = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const data = await getVendorOutstandingService(restaurantId, branchId);
    return res.json({ success: true, data });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Failed to fetch outstanding" });
  }
};

export const getVendorInvoiceActivity = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const data = await getVendorInvoiceActivityService(restaurantId, branchId);
    return res.json({ success: true, data });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Failed to fetch vendor invoice activity" });
  }
};

export const getVendorPerformance = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const data = await getVendorPerformanceService(restaurantId, branchId, from, to);
    return res.json({ success: true, data });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Failed to fetch vendor performance" });
  }
};
