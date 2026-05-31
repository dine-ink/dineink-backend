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
} from "./runningOrder.controller";

const router = Router();

router.post("/saveRunningOrder", saveRunningOrder);
router.get("/:tableId/runningOrdertable", getRunningOrderByTable);
router.post("/closeRunningOrder", closeRunningOrder);
router.get("/:restaurantId/:branchId/allRunningOrders", getAllRunningOrders);
router.patch("/:orderId/updateStatus", updateRunningOrderStatus);

// Item-level cancel request flow
router.patch("/items/:itemId/request-cancel", requestItemCancel);
router.patch("/items/:itemId/approve-cancel", approveItemCancel);
router.patch("/items/:itemId/reject-cancel", rejectItemCancel);

export default router;
