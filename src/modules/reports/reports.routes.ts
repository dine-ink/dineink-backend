import { Router } from "express";
import { getExpensesReport, getGstFilingReport } from "./reports.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnBranch, requireOwnRestaurant } from "../../middleware/authorize";

const router = Router();

router.get("/expenses", authMiddleware, requireOwnBranch(), getExpensesReport);
router.get("/gst-filing/:restaurantId/:branchId", authMiddleware, requireOwnRestaurant(), getGstFilingReport);

export default router;
