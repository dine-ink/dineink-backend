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

const router = Router();

// MENU MANAGEMENT
router.get("/:restaurantId/menu-management", authMiddleware, getMenuManagement);

// MENU ITEM ↔ INGREDIENT MAPPING
router.post("/save-menu-item-mapping", authMiddleware, saveMenuItemMapping);
router.get("/:restaurantId/get-mapped-menu", authMiddleware, getMenuItemMapping);

// RESTOCK HISTORY
router.post("/save-restock-history", authMiddleware, saveRestockHistory);
router.get("/:restaurantId/get-restock-history", authMiddleware, getRestockHistory);

// INVENTORY ADJUSTMENTS — GET /api/inventory/adjustments?branchId=&from=&to=
router.get("/adjustments", authMiddleware, getAdjustments);

// INGREDIENT LIFECYCLE — GET /api/inventory/lifecycle?branchId=&month=&year=
router.get("/lifecycle", authMiddleware, getLifecycle);

// DAILY STOCK AUDIT
router.get("/daily-audit/preview", authMiddleware, getDailyAuditPreview);
router.post("/daily-audit", authMiddleware, saveDailyAudit);
router.get("/daily-audit/history", authMiddleware, getDailyAuditHistory);

export default router;
