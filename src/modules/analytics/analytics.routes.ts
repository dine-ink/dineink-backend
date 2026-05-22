import { Router } from "express";
import {
  getBranchDashboardOverview,
  getBranchInsights,
  getDashboardOverview,
  getRestaurantDashboardOverview,
  getRestaurantInsights,
  saveRestaurantInsights,
} from "./analytics.controller";

const router = Router();

router.get(
  "/:restaurantId/restaurantDashboardOverview",
  getRestaurantDashboardOverview,
);
router.get(
  "/:restaurantId/:branchId/branchDashboardOverview",
  getBranchDashboardOverview,
);
router.post("/insights", saveRestaurantInsights);
router.get("/insights/:restaurantId/:branchId", getBranchInsights);
router.get("/:restaurantId/getRestaurantInsights", getRestaurantInsights);
router.get("/dashboardOverview", getDashboardOverview);

export default router;
