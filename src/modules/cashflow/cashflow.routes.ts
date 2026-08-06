import express from "express";
import { getCashFlowProjection, getDailyCashInflow } from "./cashflow.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnRestaurant, requireOwnBranch, requireRole } from "../../middleware/authorize";

const router = express.Router();

// Cash Flow Predictor nets vendor invoices, EMI dues, payroll and GST
// obligations against projected revenue — financially sensitive in the same
// way emi/compliance/vendors are, so gated to OWNER/MANAGER on top of the
// usual auth + tenant-ownership checks.
router.use(authMiddleware, requireRole("OWNER", "MANAGER"));

router.get(
  "/:restaurantId/:branchId/projection",
  requireOwnRestaurant(),
  requireOwnBranch(),
  getCashFlowProjection,
);

router.get(
  "/:restaurantId/:branchId/inflow-daily",
  requireOwnRestaurant(),
  requireOwnBranch(),
  getDailyCashInflow,
);

export default router;
