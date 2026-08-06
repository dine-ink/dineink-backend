import { Router } from "express";
import {
  generateForecast,
  getBranchRanking,
  getDemandForecast,
  getForecast,
  getForecastAccuracy,
  getForecastVsActual,
  getInventoryForecast,
  getPeakHourForecast,
  listForecasts,
} from "./forecast.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnRestaurant } from "../../middleware/authorize";

const router = Router();

// Ownership of a specific forecast/branch is verified inside the service
// layer (findOwnedForecast checks forecast.restaurantId) — requireOwnRestaurant
// on :restaurantId is the tenant-isolation boundary for every route here,
// matching budget.routes.ts / scenario.routes.ts exactly.
router.get("/:restaurantId/generate", authMiddleware, requireOwnRestaurant(), generateForecast);
router.get("/:restaurantId/accuracy", authMiddleware, requireOwnRestaurant(), getForecastAccuracy);
router.get("/:restaurantId/branch-ranking", authMiddleware, requireOwnRestaurant(), getBranchRanking);
// Peak-hour / demand / inventory forecasting — declared here, ABOVE the
// generic "/:restaurantId/:forecastId" route below, so these named segments
// are never swallowed by :forecastId's numeric-id matching. branchId/period/
// model/topN are query params, matching generateForecast's own
// ?branchId=&period=&model= convention exactly rather than introducing a
// new :branchId path segment style.
router.get("/:restaurantId/peak-hour", authMiddleware, requireOwnRestaurant(), getPeakHourForecast);
router.get("/:restaurantId/demand", authMiddleware, requireOwnRestaurant(), getDemandForecast);
router.get("/:restaurantId/inventory", authMiddleware, requireOwnRestaurant(), getInventoryForecast);
router.get("/:restaurantId", authMiddleware, requireOwnRestaurant(), listForecasts);
router.get("/:restaurantId/:forecastId", authMiddleware, requireOwnRestaurant(), getForecast);
router.get("/:restaurantId/:forecastId/vs-actual", authMiddleware, requireOwnRestaurant(), getForecastVsActual);

export default router;
