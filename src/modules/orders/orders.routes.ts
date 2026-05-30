import { Router } from "express";
import { getRunningOrders } from "./orders.controller";
import { authMiddleware } from "../../middleware/auth";

const router = Router();

// GET /api/orders/running?branchId=&restaurantId=&from=&to=
router.get("/running", authMiddleware, getRunningOrders);

export default router;
