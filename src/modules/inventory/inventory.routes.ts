import { Router } from "express";

import {
  getMenuManagement,
  saveMenuItemMapping,
  getMenuItemMapping,
  saveRestockHistory,
  getRestockHistory,
  getAdjustments,
  getLifecycle,
  getDailyAuditPreview,
  saveDailyAudit,
  getDailyAuditHistory,
} from "./inventory.controller";

import { authMiddleware } from "../../middleware/auth";
import { requireOwnBranch, requireOwnRestaurant } from "../../middleware/authorize";

const router = Router();

// MENU MANAGEMENT
router.get("/:restaurantId/menu-management", authMiddleware, requireOwnRestaurant(), getMenuManagement);

// MENU ITEM ↔ INGREDIENT MAPPING
router.post("/save-menu-item-mapping", authMiddleware, saveMenuItemMapping);
router.get("/:restaurantId/get-mapped-menu", authMiddleware, requireOwnRestaurant(), getMenuItemMapping);

// RESTOCK HISTORY
router.post("/save-restock-history", authMiddleware, saveRestockHistory);
router.get("/:restaurantId/get-restock-history", authMiddleware, requireOwnRestaurant(), getRestockHistory);

// INVENTORY ADJUSTMENTS — GET /api/inventory/adjustments?branchId=&from=&to=
router.get("/adjustments", authMiddleware, requireOwnBranch(), getAdjustments);

// INGREDIENT LIFECYCLE — GET /api/inventory/lifecycle?branchId=&month=&year=
router.get("/lifecycle", authMiddleware, requireOwnBranch(), getLifecycle);

// DAILY STOCK AUDIT
router.get("/daily-audit/preview", authMiddleware, requireOwnBranch(), getDailyAuditPreview);
router.post("/daily-audit", authMiddleware, saveDailyAudit);
router.get("/daily-audit/history", authMiddleware, requireOwnBranch(), getDailyAuditHistory);

export default router;
