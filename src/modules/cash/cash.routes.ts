import { Router } from "express";
import { getCashSessions, openCashSession, closeCashSession } from "./cash.controller";
import { authMiddleware } from "../../middleware/auth";

const router = Router();

router.get("/sessions", authMiddleware, getCashSessions);
router.post("/open", authMiddleware, openCashSession);
router.put("/close/:id", authMiddleware, closeCashSession);

export default router;
