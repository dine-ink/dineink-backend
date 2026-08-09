import { Router } from "express";
import {
  createBudget,
  deleteBudget,
  duplicateBudget,
  getBudget,
  getBudgetVariance,
  getFixedCostDefaults,
  listBudgets,
  updateBudget,
  upsertBudgetItems,
} from "./budget.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnRestaurant } from "../../middleware/authorize";

const router = Router();

// Ownership of a specific budget/branch is verified inside the service layer
// (findOwnedBudget checks budget.restaurantId; a budget's branchId, if set,
// necessarily already belongs to that same restaurant) — requireOwnRestaurant
// on :restaurantId is the tenant-isolation boundary for every route here.
router.post("/:restaurantId", authMiddleware, requireOwnRestaurant(), createBudget);
router.get("/:restaurantId", authMiddleware, requireOwnRestaurant(), listBudgets);
// Registered before the generic /:budgetId route below — otherwise "fixed-defaults" would be swallowed as a budgetId value.
router.get("/:restaurantId/fixed-defaults", authMiddleware, requireOwnRestaurant(), getFixedCostDefaults);
router.get("/:restaurantId/:budgetId", authMiddleware, requireOwnRestaurant(), getBudget);
router.put("/:restaurantId/:budgetId", authMiddleware, requireOwnRestaurant(), updateBudget);
router.delete("/:restaurantId/:budgetId", authMiddleware, requireOwnRestaurant(), deleteBudget);
router.put("/:restaurantId/:budgetId/items", authMiddleware, requireOwnRestaurant(), upsertBudgetItems);
router.post("/:restaurantId/:budgetId/duplicate", authMiddleware, requireOwnRestaurant(), duplicateBudget);
router.get("/:restaurantId/:budgetId/variance", authMiddleware, requireOwnRestaurant(), getBudgetVariance);

export default router;
