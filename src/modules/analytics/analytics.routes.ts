import { Router } from "express";
import {
  getBranchDashboardOverview,
  getBranchInsights,
  getDashboardOverview,
  getRestaurantDashboardOverview,
  getRestaurantInsights,
  saveRestaurantInsights,
  getBranchComparison,
  getCityComparison,
} from "./analytics.controller";
import { authMiddleware } from "../../middleware/auth";

const router = Router();

router.get("/:restaurantId/restaurantDashboardOverview", getRestaurantDashboardOverview);
router.get("/:restaurantId/:branchId/branchDashboardOverview", getBranchDashboardOverview);
router.post("/insights", saveRestaurantInsights);
router.get("/insights/:restaurantId/:branchId", getBranchInsights);
router.get("/:restaurantId/getRestaurantInsights", getRestaurantInsights);
router.get("/dashboardOverview", getDashboardOverview);

// Branch & City comparison analytics
router.get("/:restaurantId/branch-comparison", authMiddleware, getBranchComparison);
router.get("/:restaurantId/city-comparison", authMiddleware, getCityComparison);

export default router;
