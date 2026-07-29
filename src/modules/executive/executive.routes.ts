import { Router } from "express";
import {
  deleteKpiTarget,
  getAlerts,
  getHealthScore,
  getInsightPanels,
  getMultiBranchView,
  getOverview,
  getPreference,
  getScorecards,
  getTimeline,
  listKpiTargets,
  savePreference,
  setKpiTarget,
} from "./executive.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnRestaurant } from "../../middleware/authorize";

const router = Router();

router.get("/:restaurantId/overview", authMiddleware, requireOwnRestaurant(), getOverview);
router.get("/:restaurantId/scorecards", authMiddleware, requireOwnRestaurant(), getScorecards);
router.get("/:restaurantId/health-score", authMiddleware, requireOwnRestaurant(), getHealthScore);
router.get("/:restaurantId/multi-branch", authMiddleware, requireOwnRestaurant(), getMultiBranchView);
router.get("/:restaurantId/timeline", authMiddleware, requireOwnRestaurant(), getTimeline);
router.get("/:restaurantId/alerts", authMiddleware, requireOwnRestaurant(), getAlerts);
router.get("/:restaurantId/insight-panels", authMiddleware, requireOwnRestaurant(), getInsightPanels);

router.get("/:restaurantId/kpi-targets", authMiddleware, requireOwnRestaurant(), listKpiTargets);
router.put("/:restaurantId/kpi-targets", authMiddleware, requireOwnRestaurant(), setKpiTarget);
router.delete("/:restaurantId/kpi-targets/:kpiKey", authMiddleware, requireOwnRestaurant(), deleteKpiTarget);

// Preferences are keyed off the authenticated user, not restaurantId — still
// mounted under :restaurantId (for consistency with every other route here
// and so requireOwnRestaurant's tenant check still applies), but the
// controller reads/writes only (req as any).user.id, never a client-supplied id.
router.get("/:restaurantId/preferences", authMiddleware, requireOwnRestaurant(), getPreference);
router.put("/:restaurantId/preferences", authMiddleware, requireOwnRestaurant(), savePreference);

export default router;
