import express from "express";
import {
  getMonthlyDues,
  createMonthlyDue,
  updateMonthlyDue,
  deleteMonthlyDue,
  getPaymentCalendar,
  getMonthComparison,
  getEbitdaSummary,
} from "./dues.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnRestaurant, requireOwnBranch, requireRole } from "../../middleware/authorize";

const router = express.Router();

// Dues Tracker data (EB/Salaries/Rent/Operations/Utilities/Maintenance/Misc/
// EMI amounts, payment calendar, EBITDA impact) is financially sensitive,
// same as the EMI module — gated to OWNER/MANAGER on top of the usual auth +
// tenant-ownership checks.
router.use(authMiddleware, requireRole("OWNER", "MANAGER"));

router.get("/:restaurantId/:branchId", requireOwnRestaurant(), requireOwnBranch(), getMonthlyDues);

router.get(
  "/:restaurantId/:branchId/payment-calendar",
  requireOwnRestaurant(),
  requireOwnBranch(),
  getPaymentCalendar,
);

router.get(
  "/:restaurantId/:branchId/month-comparison",
  requireOwnRestaurant(),
  requireOwnBranch(),
  getMonthComparison,
);

router.get(
  "/:restaurantId/:branchId/ebitda-summary",
  requireOwnRestaurant(),
  requireOwnBranch(),
  getEbitdaSummary,
);

router.post("/", createMonthlyDue);
router.put("/:id", updateMonthlyDue);
router.delete("/:id", deleteMonthlyDue);

export default router;
