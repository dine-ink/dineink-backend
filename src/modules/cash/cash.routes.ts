import { Router } from "express";
import {
  getCashSessions,
  openCashSession,
  closeCashSession,
  getShiftSalesSummary,
} from "./cash.controller";
import { authMiddleware } from "../../middleware/auth";

const router = Router();

router.get("/sessions", authMiddleware, getCashSessions);
router.post("/open", authMiddleware, openCashSession);
router.put("/close/:id", authMiddleware, closeCashSession);
router.get("/shift-summary/:branchId", authMiddleware, getShiftSalesSummary);

export default router;
