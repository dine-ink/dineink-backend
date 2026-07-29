import { Router } from "express";
import {
  createBudget,
  duplicateBudget,
  getBudget,
  getBudgetVariance,
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
router.get("/:restaurantId/:budgetId", authMiddleware, requireOwnRestaurant(), getBudget);
router.put("/:restaurantId/:budgetId", authMiddleware, requireOwnRestaurant(), updateBudget);
router.put("/:restaurantId/:budgetId/items", authMiddleware, requireOwnRestaurant(), upsertBudgetItems);
router.post("/:restaurantId/:budgetId/duplicate", authMiddleware, requireOwnRestaurant(), duplicateBudget);
router.get("/:restaurantId/:budgetId/variance", authMiddleware, requireOwnRestaurant(), getBudgetVariance);

export default router;
