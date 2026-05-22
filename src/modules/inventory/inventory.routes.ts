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

// MENU MANAGEMENT
router.get("/:restaurantId/menu-management", authMiddleware, getMenuManagement);

// MENU ITEM ↔ INGREDIENT MAPPING
router.post("/save-menu-item-mapping", authMiddleware, saveMenuItemMapping);
router.get(
  "/:restaurantId/get-mapped-menu",
  authMiddleware,
  getMenuItemMapping,
);

// RESTOCK HISTORY
router.post("/save-restock-history", authMiddleware, saveRestockHistory);
router.get(
  "/:restaurantId/get-restock-history",
  authMiddleware,
  getRestockHistory,
);

export default router;
