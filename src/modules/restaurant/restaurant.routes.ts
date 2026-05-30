import { Router } from "express";

import {
  setupRestaurant,
  getShops,
  getMyRestaurant,
  getBranchDetails,
  updateBranchDetails,
  getRestaurantStaff,
  getTablesController,
  createRestaurantTable,
  deleteRestaurantTable,
} from "./restaurant.controller";

import {
  getRestaurantSettings,
  updateBranches,
  updateGeneralSettings,
} from "../settings/settings.controller";

import { authMiddleware } from "../../middleware/auth";
import { upload } from "../../middleware/upload";

const router = Router();

router.post("/setup", authMiddleware, upload.single("logo"), setupRestaurant);
router.get("/shops", authMiddleware, getShops);
router.get("/my-restaurant", authMiddleware, getMyRestaurant);
router.get("/branch/:id", authMiddleware, getBranchDetails);
router.put("/branch/:id", authMiddleware, updateBranchDetails);
router.get("/staff/:restaurantId/:branchId", getRestaurantStaff);
router.get("/table/:restaurantId/:branchId", getTablesController);
router.post("/restaurant-table/create", authMiddleware, createRestaurantTable);
router.delete("/restaurant-table/delete/:id", authMiddleware, deleteRestaurantTable);

// Settings aliases — frontend calls /api/restaurant/settings/... instead of /api/settings/...
router.get("/settings/:restaurantId", authMiddleware, getRestaurantSettings);
router.put("/branches/update", authMiddleware, updateBranches);
router.put("/general/:id", authMiddleware, updateGeneralSettings);

export default router;
