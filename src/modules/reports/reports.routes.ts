import { Router } from "express";
import { getExpensesReport } from "./reports.controller";
import { authMiddleware } from "../../middleware/auth";

const router = Router();

router.get("/expenses", authMiddleware, getExpensesReport);

export default router;
