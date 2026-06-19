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
} from "./vendor.service";

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

export const createVendorPayment = async (req: Request, res: Response) => {
  try {
    const data = await createVendorPaymentService(req.body);
    return res.status(201).json({ success: true, data });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Failed to record payment" });
  }
};

export const deleteVendorPayment = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    await deleteVendorPaymentService(id);
    return res.json({ success: true });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Failed to delete payment" });
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

export const createVendorInvoice = async (req: Request, res: Response) => {
  try {
    const data = await createVendorInvoiceService(req.body);
    return res.status(201).json({ success: true, data });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Failed to create invoice" });
  }
};

export const payVendorInvoice = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { amount } = req.body;
    const data = await payVendorInvoiceService(id, Number(amount));
    return res.json({ success: true, data });
  } catch (err: any) {
    console.log(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteVendorInvoice = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    await deleteVendorInvoiceService(id);
    return res.json({ success: true });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Failed to delete invoice" });
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
