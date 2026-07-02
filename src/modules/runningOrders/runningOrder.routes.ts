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
  holdRunningOrder,
  resumeRunningOrder,
  discardRunningOrder,
} from "./runningOrder.controller";

const router = Router();

router.post("/saveRunningOrder", saveRunningOrder);
router.get("/:tableId/runningOrdertable", getRunningOrderByTable);
router.post("/closeRunningOrder", closeRunningOrder);
router.get("/:restaurantId/:branchId/allRunningOrders", getAllRunningOrders);
router.patch("/:orderId/updateStatus", updateRunningOrderStatus);

// Hold / resume / discard a running order
router.patch("/:orderId/hold", holdRunningOrder);
router.patch("/:orderId/resume", resumeRunningOrder);
router.delete("/:orderId/discard", discardRunningOrder);

// Item-level cancel request flow
router.patch("/items/:itemId/request-cancel", requestItemCancel);
router.patch("/items/:itemId/approve-cancel", approveItemCancel);
router.patch("/items/:itemId/reject-cancel", rejectItemCancel);

export default router;
