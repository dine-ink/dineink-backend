import { Router } from "express";
import {
  getBranchDashboardOverview,
  getBranchInsights,
  getRestaurantDashboardOverview,
  getRestaurantInsights,
  saveRestaurantInsights,
  getBranchComparison,
  getCityComparison,
  getKitchenAnalytics,
  getHourlyHeatmap,
  getCustomerRFM,
  getStaffProductivity,
  getRevenueForecast,
  getMenuEngineering,
  getTableOperations,
} from "./analytics.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnRestaurant } from "../../middleware/authorize";

const router = Router();

router.get("/:restaurantId/restaurantDashboardOverview", authMiddleware, requireOwnRestaurant(), getRestaurantDashboardOverview);
router.get("/:restaurantId/:branchId/branchDashboardOverview", authMiddleware, requireOwnRestaurant(), getBranchDashboardOverview);
router.post("/insights", authMiddleware, saveRestaurantInsights);
router.get("/insights/:restaurantId/:branchId", authMiddleware, requireOwnRestaurant(), getBranchInsights);
router.get("/:restaurantId/getRestaurantInsights", authMiddleware, requireOwnRestaurant(), getRestaurantInsights);

// Branch & City comparison analytics
router.get("/:restaurantId/branch-comparison", authMiddleware, requireOwnRestaurant(), getBranchComparison);
router.get("/:restaurantId/city-comparison", authMiddleware, requireOwnRestaurant(), getCityComparison);

// Advanced analytics
router.get("/:restaurantId/kitchen", authMiddleware, requireOwnRestaurant(), getKitchenAnalytics);
router.get("/:restaurantId/hourly-heatmap", authMiddleware, requireOwnRestaurant(), getHourlyHeatmap);
router.get("/:restaurantId/customer-rfm", authMiddleware, requireOwnRestaurant(), getCustomerRFM);
router.get("/:restaurantId/staff-productivity", authMiddleware, requireOwnRestaurant(), getStaffProductivity);
router.get("/:restaurantId/revenue-forecast", authMiddleware, requireOwnRestaurant(), getRevenueForecast);
router.get("/:restaurantId/menu-engineering", authMiddleware, requireOwnRestaurant(), getMenuEngineering);
router.get("/:restaurantId/:branchId/table-operations", authMiddleware, requireOwnRestaurant(), getTableOperations);

export default router;
