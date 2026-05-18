import { Router } from "express";

import {
  getMenuManagement,
  saveMenuItemMapping,
  getMenuItemMapping,
  saveRestockHistory,
  getRestockHistory,
} from "./inventory.controller";

import { authMiddleware } from "../../middleware/auth";

const router = Router();

router.get("/:restaurantId/menu-management", authMiddleware, getMenuManagement);
router.post("/save/menu-item-mapping", authMiddleware, saveMenuItemMapping);
router.get("/:restaurantId/getMappedMenu", authMiddleware, getMenuItemMapping);
router.post("/save-restock-history", saveRestockHistory);

router.get("/:restaurantId/get-restock-history", getRestockHistory);

export default router;
