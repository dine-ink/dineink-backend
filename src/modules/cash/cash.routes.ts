import { Router } from "express";
import {
  getCashSessions,
  openCashSession,
  closeCashSession,
  getShiftSalesSummary,
} from "./cash.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnBranch } from "../../middleware/authorize";

const router = Router();

router.get("/sessions", authMiddleware, requireOwnBranch(), getCashSessions);
router.post("/open", authMiddleware, openCashSession);
router.put("/close/:id", authMiddleware, closeCashSession);
// Scoped to one session's own open→(close or now) window, not the whole
// business day — needed now that a branch can have several concurrent
// cashier sessions, each of which needs its OWN sales figures, not the
// whole day's (which would double-count across sessions).
router.get("/shift-summary/session/:sessionId", authMiddleware, getShiftSalesSummary);

export default router;
