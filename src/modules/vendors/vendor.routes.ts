import express from "express";
import {
  getVendorPayments,
  createVendorPayment,
  deleteVendorPayment,
  getVendorInvoices,
  createVendorInvoice,
  payVendorInvoice,
  deleteVendorInvoice,
  getVendorOutstanding,
} from "./vendor.controller";
import { authMiddleware } from "../../middleware/auth";

const router = express.Router();

// Outstanding summary for all vendors of a branch
router.get("/outstanding/:restaurantId/:branchId", authMiddleware, getVendorOutstanding);

// Payments
router.get("/:vendorId/payments", authMiddleware, getVendorPayments);
router.post("/payments", authMiddleware, createVendorPayment);
router.delete("/payments/:id", authMiddleware, deleteVendorPayment);

// Invoices
router.get("/:vendorId/invoices", authMiddleware, getVendorInvoices);
router.post("/invoices", authMiddleware, createVendorInvoice);
router.put("/invoices/:id/pay", authMiddleware, payVendorInvoice);
router.delete("/invoices/:id", authMiddleware, deleteVendorInvoice);

export default router;
