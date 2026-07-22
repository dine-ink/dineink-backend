import { Router } from "express";
import { getRunningOrders } from "./orders.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnBranch } from "../../middleware/authorize";

const router = Router();

// GET /api/orders/running?branchId=&restaurantId=&from=&to=
router.get("/running", authMiddleware, requireOwnBranch(), getRunningOrders);

export default router;
