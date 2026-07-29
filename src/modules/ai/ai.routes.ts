import { Router } from "express";
import {
  askBestPerformingBranch,
  askBestROIInvestments,
  askKpisNeedingAttention,
  askWhatIfSalesIncrease,
  askWhyFoodCostChanging,
  askWhyProfitChanged,
  getAnomalies,
  getBranchNarratives,
  getExecutiveBrief,
  getInsightTimeline,
  getInsights,
  getOpportunities,
  getRecommendations,
  getRisks,
} from "./ai.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnRestaurant } from "../../middleware/authorize";

const router = Router();

router.get("/:restaurantId/insights", authMiddleware, requireOwnRestaurant(), getInsights);
router.get("/:restaurantId/risks", authMiddleware, requireOwnRestaurant(), getRisks);
router.get("/:restaurantId/opportunities", authMiddleware, requireOwnRestaurant(), getOpportunities);
router.get("/:restaurantId/recommendations", authMiddleware, requireOwnRestaurant(), getRecommendations);
router.get("/:restaurantId/anomalies", authMiddleware, requireOwnRestaurant(), getAnomalies);
router.get("/:restaurantId/insight-timeline", authMiddleware, requireOwnRestaurant(), getInsightTimeline);
router.get("/:restaurantId/executive-brief", authMiddleware, requireOwnRestaurant(), getExecutiveBrief);
router.get("/:restaurantId/branch-narratives", authMiddleware, requireOwnRestaurant(), getBranchNarratives);

// Conversational Finance API (spec section 9) — structured, deterministic answers, not an LLM/chat layer.
router.get("/:restaurantId/ask/why-profit-changed", authMiddleware, requireOwnRestaurant(), askWhyProfitChanged);
router.get("/:restaurantId/ask/best-performing-branch", authMiddleware, requireOwnRestaurant(), askBestPerformingBranch);
router.get("/:restaurantId/ask/why-food-cost-changing", authMiddleware, requireOwnRestaurant(), askWhyFoodCostChanging);
router.get("/:restaurantId/ask/best-roi-investments", authMiddleware, requireOwnRestaurant(), askBestROIInvestments);
router.get("/:restaurantId/ask/what-if-sales-increase", authMiddleware, requireOwnRestaurant(), askWhatIfSalesIncrease);
router.get("/:restaurantId/ask/kpis-needing-attention", authMiddleware, requireOwnRestaurant(), askKpisNeedingAttention);

export default router;
