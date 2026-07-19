import { Router } from "express";
import { getExpensesReport, getGstFilingReport } from "./reports.controller";
import { authMiddleware } from "../../middleware/auth";

const router = Router();

router.get("/expenses", authMiddleware, getExpensesReport);
router.get("/gst-filing/:restaurantId/:branchId", authMiddleware, getGstFilingReport);

export default router;
