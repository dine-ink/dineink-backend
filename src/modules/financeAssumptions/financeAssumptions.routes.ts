import { Router } from "express";
import {
  getRestaurantDefaults,
  getResolvedAssumptions,
  updateBranchOverrides,
  updateRestaurantDefaults,
} from "./financeAssumptions.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnBranch, requireOwnRestaurant } from "../../middleware/authorize";

const router = Router();

// Restaurant-level defaults
router.get("/:restaurantId", authMiddleware, requireOwnRestaurant(), getRestaurantDefaults);
router.put("/:restaurantId", authMiddleware, requireOwnRestaurant(), updateRestaurantDefaults);

// Branch-level: GET returns the resolved (default + override merged) view;
// PUT writes only that branch's own override row.
router.get(
  "/:restaurantId/:branchId",
  authMiddleware,
  requireOwnRestaurant(),
  requireOwnBranch(),
  getResolvedAssumptions,
);
router.put(
  "/:restaurantId/:branchId",
  authMiddleware,
  requireOwnRestaurant(),
  requireOwnBranch(),
  updateBranchOverrides,
);

export default router;
