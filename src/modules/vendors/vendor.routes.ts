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
  getVendorPerformance,
  getVendorInvoiceActivity,
} from "./vendor.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnRestaurant } from "../../middleware/authorize";

const router = express.Router();

// Outstanding summary for all vendors of a branch
router.get("/outstanding/:restaurantId/:branchId", authMiddleware, requireOwnRestaurant(), getVendorOutstanding);

// Purchase volume, overdue balances and price-trend per vendor
router.get("/performance/:restaurantId/:branchId", authMiddleware, requireOwnRestaurant(), getVendorPerformance);

// Whether any vendor invoice has ever been logged for this branch (used to
// distinguish "no purchasing data" from "fully paid" in Cash Conversion Cycle)
router.get("/invoice-activity/:restaurantId/:branchId", authMiddleware, requireOwnRestaurant(), getVendorInvoiceActivity);

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
