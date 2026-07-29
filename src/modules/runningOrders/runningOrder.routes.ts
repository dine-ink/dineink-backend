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

// Every route below requires authMiddleware, and every mutation is
// ownership-checked in its service function (fetch-then-compare against the
// caller's own restaurantId, same pattern as restaurant/admin/vendor/cash) —
// none of them carry restaurantId as a URL param, so there's nothing for
// requireOwnRestaurant()/requireOwnBranch() to check at the route level.
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
