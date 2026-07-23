import { Router } from "express";
import { getSuppliers, getPrices, getHistory, ingest } from "./procurement.controller";
import { authMiddleware } from "../../middleware/auth";

const router = Router();

router.get("/suppliers", authMiddleware, getSuppliers);
router.get("/prices", authMiddleware, getPrices);
router.get("/history", authMiddleware, getHistory);
router.post("/ingest", authMiddleware, ingest);

export default router;
