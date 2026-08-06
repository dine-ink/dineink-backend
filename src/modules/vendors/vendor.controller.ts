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
  getVendorPricingHistoryService,
  reorderVendorService,
} from "./vendor.service";
import { ForbiddenError } from "./vendor.validation";

// Messages reorderVendorService throws as plain Errors (vendor exists and is
// owned by the caller, it's just missing the contact detail the chosen
// channel needs) — an expected client-fixable condition, not a server
// failure, so these map to 400 rather than falling through to the 500
// default below.
const CLIENT_ERROR_MESSAGES = ["Vendor has no phone number on file", "Vendor has no email on file", "Invalid reorder channel"];

const handleError = (error: any, res: Response, message: string) => {
  console.log(error);
  if (error instanceof ForbiddenError) {
    return res.status(403).json({ success: false, message: error.message });
  }
  if (error?.message && CLIENT_ERROR_MESSAGES.includes(error.message)) {
    return res.status(400).json({ success: false, message: error.message });
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
    const body = { ...req.body };

    // When an e-bill is attached the request is multipart/form-data, so
    // multer hands every non-file field back as a plain string — numeric and
    // JSON fields need re-parsing here. The existing JSON-only (no file)
    // request path is untouched: req.file is undefined, so body passes
    // through exactly as before.
    if (req.file) {
      if (body.totalAmount !== undefined) body.totalAmount = Number(body.totalAmount);
      if (body.branchId !== undefined) body.branchId = Number(body.branchId);
      if (body.vendorId !== undefined) body.vendorId = Number(body.vendorId);
      if (typeof body.items === "string") {
        try {
          body.items = JSON.parse(body.items);
        } catch {
          // Not actually JSON — leave the raw string as-is.
        }
      }
      body.documentUrl = `/uploads/${req.file.filename}`;
    }

    const data = await createVendorInvoiceService(Number(req.user.restaurantId), body);
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

export const getVendorPricingHistory = async (req: any, res: Response) => {
  try {
    const vendorId = Number(req.params.vendorId);
    const data = await getVendorPricingHistoryService(Number(req.user.restaurantId), vendorId);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to fetch pricing history");
  }
};

export const reorderVendor = async (req: any, res: Response) => {
  try {
    const vendorId = Number(req.params.vendorId);
    const data = await reorderVendorService(Number(req.user.restaurantId), {
      ...req.body,
      vendorId,
      createdById: req.user.id,
    });
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to send reorder request");
  }
};
