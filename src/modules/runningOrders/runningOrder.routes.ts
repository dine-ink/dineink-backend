import { Router } from "express";
import {
  saveRunningOrder,
  getRunningOrderByTable,
  closeRunningOrder,
  getAllRunningOrders,
  updateRunningOrderStatus,
  requestItemCancel,
  approveItemCancel,
  rejectItemCancel,
  toggleItemDone,
  holdRunningOrder,
  resumeRunningOrder,
  discardRunningOrder,
  transferTable,
} from "./runningOrder.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnRestaurant } from "../../middleware/authorize";

const router = Router();

// This entire module had no authMiddleware at all — order placement, table
// transfer, and bill-creating "closeRunningOrder" were all reachable by
// anyone, unauthenticated. The item-id/order-id-based routes below still
// have no ownership check (that would need a per-row restaurantId lookup,
// same as the SOP/vendor fixes elsewhere) — flagged as a residual gap.
router.post("/saveRunningOrder", authMiddleware, saveRunningOrder);
router.get("/:tableId/runningOrdertable", authMiddleware, getRunningOrderByTable);
router.post("/closeRunningOrder", authMiddleware, closeRunningOrder);
router.get("/:restaurantId/:branchId/allRunningOrders", authMiddleware, requireOwnRestaurant(), getAllRunningOrders);
router.patch("/:orderId/updateStatus", authMiddleware, updateRunningOrderStatus);

// Hold / resume / discard a running order
router.patch("/:orderId/hold", authMiddleware, holdRunningOrder);
router.patch("/:orderId/resume", authMiddleware, resumeRunningOrder);
router.delete("/:orderId/discard", authMiddleware, discardRunningOrder);
router.post("/transferTable", authMiddleware, transferTable);

// Item-level cancel request flow
router.patch("/items/:itemId/request-cancel", authMiddleware, requestItemCancel);
router.patch("/items/:itemId/approve-cancel", authMiddleware, approveItemCancel);
router.patch("/items/:itemId/reject-cancel", authMiddleware, rejectItemCancel);
router.patch("/items/:itemId/toggle-done", authMiddleware, toggleItemDone);

export default router;
