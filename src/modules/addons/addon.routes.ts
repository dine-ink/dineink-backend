import { Router } from "express";
import {
  getAddOnGroups,
  createAddOnGroup,
  updateAddOnGroup,
  deleteAddOnGroup,
  createAddOn,
  updateAddOn,
  deleteAddOn,
  attachAddOnGroup,
  detachAddOnGroup,
  getMenuItemAddOnGroups,
  getRestaurantAddOnAttachments,
} from "./addon.controller";
import { authMiddleware } from "../../middleware/auth";

const router = Router();

// Groups
router.get("/groups/:restaurantId", authMiddleware, getAddOnGroups);
router.post("/groups", authMiddleware, createAddOnGroup);
router.put("/groups/:id", authMiddleware, updateAddOnGroup);
router.delete("/groups/:id", authMiddleware, deleteAddOnGroup);

// Options within a group
router.post("/options", authMiddleware, createAddOn);
router.put("/options/:id", authMiddleware, updateAddOn);
router.delete("/options/:id", authMiddleware, deleteAddOn);

// Bulk map of menuItemId -> attached groups, for POS menu prefetch
router.get("/restaurant/:restaurantId/attachments", authMiddleware, getRestaurantAddOnAttachments);

// Attaching groups to menu items
router.get("/menu-items/:menuItemId", authMiddleware, getMenuItemAddOnGroups);
router.post("/menu-items/:menuItemId/groups", authMiddleware, attachAddOnGroup);
router.delete("/menu-items/:menuItemId/groups/:addOnGroupId", authMiddleware, detachAddOnGroup);

export default router;
