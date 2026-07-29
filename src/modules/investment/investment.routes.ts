import { Router } from "express";
import {
  createInvestment,
  deleteInvestment,
  getBranchRanking,
  getInvestment,
  getInvestmentForecastComparison,
  getInvestmentMetrics,
  getPortfolio,
  listInvestments,
  listInvestmentsWithMetrics,
  updateInvestment,
} from "./investment.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnRestaurant } from "../../middleware/authorize";

const router = Router();

// Ownership of a specific investment/branch is verified inside the service
// layer (findOwnedInvestment checks investment.restaurantId) —
// requireOwnRestaurant on :restaurantId is the tenant-isolation boundary for
// every route here, matching budget/scenario/forecast.routes.ts exactly.
router.post("/:restaurantId", authMiddleware, requireOwnRestaurant(), createInvestment);
router.get("/:restaurantId", authMiddleware, requireOwnRestaurant(), listInvestments);
router.get("/:restaurantId/with-metrics", authMiddleware, requireOwnRestaurant(), listInvestmentsWithMetrics);
router.get("/:restaurantId/portfolio", authMiddleware, requireOwnRestaurant(), getPortfolio);
router.get("/:restaurantId/branch-ranking", authMiddleware, requireOwnRestaurant(), getBranchRanking);
router.get("/:restaurantId/:investmentId", authMiddleware, requireOwnRestaurant(), getInvestment);
router.put("/:restaurantId/:investmentId", authMiddleware, requireOwnRestaurant(), updateInvestment);
router.delete("/:restaurantId/:investmentId", authMiddleware, requireOwnRestaurant(), deleteInvestment);
router.get("/:restaurantId/:investmentId/metrics", authMiddleware, requireOwnRestaurant(), getInvestmentMetrics);
router.get("/:restaurantId/:investmentId/forecast-comparison", authMiddleware, requireOwnRestaurant(), getInvestmentForecastComparison);

export default router;
