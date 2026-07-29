import { Router } from "express";
import { getFinancialSummary, getRatioReport } from "./finance.controller";
import { getStatement } from "./finance.statements.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnRestaurant, requireOwnBranch } from "../../middleware/authorize";

const router = Router();

// The canonical financial KPI endpoint — EBITDA, Prime Cost, Net Profit,
// Break-even, etc., computed once via finance.formulas.ts. Every screen that
// used to compute these independently should call this instead.
router.get(
  "/:restaurantId/:branchId/summary",
  authMiddleware,
  requireOwnRestaurant(),
  requireOwnBranch(),
  getFinancialSummary,
);

// The Ratio/Period Engine — every KPI across every period, target,
// achievement %, and trend, in one call.
router.get(
  "/:restaurantId/:branchId/ratios",
  authMiddleware,
  requireOwnRestaurant(),
  requireOwnBranch(),
  getRatioReport,
);

// Financial Statement generators — P&L, Income/Expense Statement, Food
// Cost/Labour/Utility Reports, Branch/Restaurant Financial Summary. `type`
// is one of pnl|income|expense|foodCost|labour|utility|branchSummary|
// restaurantSummary; `period` (+ optional from/to) selects daily/monthly/
// quarterly/yearly/custom the same way every other finance endpoint does.
router.get(
  "/:restaurantId/:branchId/statements/:type",
  authMiddleware,
  requireOwnRestaurant(),
  requireOwnBranch(),
  getStatement,
);

export default router;
