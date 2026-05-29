import { Router } from "express";
import {
  saveRunningOrder,
  getRunningOrderByTable,
  closeRunningOrder,
  getAllRunningOrders,
  updateRunningOrderStatus,
} from "./runningOrder.controller";

const router = Router();

router.post("/saveRunningOrder", saveRunningOrder);
router.get("/:tableId/runningOrdertable", getRunningOrderByTable);
router.post("/closeRunningOrder", closeRunningOrder);
router.get("/:restaurantId/:branchId/allRunningOrders", getAllRunningOrders);
router.patch("/:orderId/updateStatus", updateRunningOrderStatus);

export default router;
