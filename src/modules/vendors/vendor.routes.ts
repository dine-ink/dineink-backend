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
  getVendorPricingHistory,
  reorderVendor,
} from "./vendor.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnRestaurant, requireRole } from "../../middleware/authorize";
import { uploadDocument } from "../../middleware/upload";

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
// uploadDocument.single("document") is a no-op when the request body is
// plain JSON (no file part) — the existing JSON-only invoice-creation flow
// keeps working exactly as before; it only kicks in when the caller sends
// multipart/form-data with a "document" field attached (the e-bill).
router.post("/invoices", authMiddleware, uploadDocument.single("document"), createVendorInvoice);
router.put("/invoices/:id/pay", authMiddleware, payVendorInvoice);
router.delete("/invoices/:id", authMiddleware, deleteVendorInvoice);

// Vendor Intelligence: pricing history + reorder action — new routes only,
// gated with requireRole in addition to authMiddleware. Existing routes
// above are left exactly as they were (no requireRole added retroactively).
router.get("/:vendorId/pricing-history", authMiddleware, requireRole("OWNER", "MANAGER"), getVendorPricingHistory);
router.post("/:vendorId/reorder", authMiddleware, requireRole("OWNER", "MANAGER"), reorderVendor);

export default router;
