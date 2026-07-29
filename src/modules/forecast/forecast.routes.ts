import { Router } from "express";
import { generateForecast, getBranchRanking, getForecast, getForecastAccuracy, getForecastVsActual, listForecasts } from "./forecast.controller";
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
router.get("/:restaurantId", authMiddleware, requireOwnRestaurant(), listForecasts);
router.get("/:restaurantId/:forecastId", authMiddleware, requireOwnRestaurant(), getForecast);
router.get("/:restaurantId/:forecastId/vs-actual", authMiddleware, requireOwnRestaurant(), getForecastVsActual);

export default router;
