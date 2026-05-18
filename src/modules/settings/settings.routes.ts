import { Router } from "express";

import { authMiddleware } from "../../middleware/auth";
import {
  getRestaurantSettings,
  updateBranches,
  updateGeneralSettings,
} from "./settings.controller";

const router = Router();

router.get("/:restaurantId", authMiddleware, getRestaurantSettings);

router.put("/branches/update", authMiddleware, updateBranches);

router.put("/general/:id", authMiddleware, updateGeneralSettings);

export default router;
