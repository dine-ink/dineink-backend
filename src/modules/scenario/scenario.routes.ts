import { Router } from "express";
import {
  cloneScenario,
  createScenario,
  deleteScenario,
  getScenario,
  getScenarioWhatIf,
  listScenarios,
  resetScenarioFields,
  updateScenario,
} from "./scenario.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnRestaurant } from "../../middleware/authorize";

const router = Router();

// Ownership of a specific scenario/branch is verified inside the service
// layer (findOwnedScenario checks scenario.restaurantId) — requireOwnRestaurant
// on :restaurantId is the tenant-isolation boundary for every route here,
// matching budget.routes.ts exactly.
router.post("/:restaurantId", authMiddleware, requireOwnRestaurant(), createScenario);
router.get("/:restaurantId", authMiddleware, requireOwnRestaurant(), listScenarios);
router.get("/:restaurantId/:scenarioId", authMiddleware, requireOwnRestaurant(), getScenario);
router.put("/:restaurantId/:scenarioId", authMiddleware, requireOwnRestaurant(), updateScenario);
router.post("/:restaurantId/:scenarioId/clone", authMiddleware, requireOwnRestaurant(), cloneScenario);
router.put("/:restaurantId/:scenarioId/reset-fields", authMiddleware, requireOwnRestaurant(), resetScenarioFields);
router.delete("/:restaurantId/:scenarioId", authMiddleware, requireOwnRestaurant(), deleteScenario);
// POST (not GET) so interactive what-if sliders can pass live, unsaved
// override deltas in the body — nothing in the body is ever persisted.
router.post("/:restaurantId/:scenarioId/what-if", authMiddleware, requireOwnRestaurant(), getScenarioWhatIf);

export default router;
