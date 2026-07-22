import { Router } from "express";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnRestaurant } from "../../middleware/authorize";
import {
  getRestaurantSettings,
  updateBranches,
  updateGeneralSettings,
  createBranch,
} from "./settings.controller";

const router = Router();

router.get("/:restaurantId", authMiddleware, requireOwnRestaurant(), getRestaurantSettings);
router.put("/branches/update", authMiddleware, updateBranches);
router.put("/general/:id", authMiddleware, requireOwnRestaurant("id"), updateGeneralSettings);
router.post("/branches/create", authMiddleware, createBranch);

export default router;
