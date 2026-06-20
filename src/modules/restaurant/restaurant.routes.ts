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
  updateRestaurantLogo,
  createStaff,
  updateStaff,
} from "./restaurant.controller";

import {
  getRestaurantSettings,
  updateBranches,
  updateGeneralSettings,
  createBranch,
} from "../settings/settings.controller";

import { authMiddleware } from "../../middleware/auth";
import { upload } from "../../middleware/upload";

const router = Router();

router.post("/setup", authMiddleware, upload.single("logo"), setupRestaurant);
router.get("/shops", authMiddleware, getShops);
router.get("/my-restaurant", authMiddleware, getMyRestaurant);
router.get("/branch/:id", authMiddleware, getBranchDetails);
router.put("/branch/:id", authMiddleware, updateBranchDetails);
router.get("/staff/:restaurantId/:branchId", authMiddleware, getRestaurantStaff);
router.get("/table/:restaurantId/:branchId", authMiddleware, getTablesController);
router.post("/restaurant-table/create", authMiddleware, createRestaurantTable);
router.delete("/restaurant-table/delete/:id", authMiddleware, deleteRestaurantTable);
router.post("/update-logo", authMiddleware, upload.single("logo"), updateRestaurantLogo);
router.post("/staff/create", authMiddleware, createStaff);
router.put("/staff/:id", authMiddleware, updateStaff);

// Settings aliases — frontend calls /api/restaurant/settings/... instead of /api/settings/...
router.get("/settings/:restaurantId", authMiddleware, getRestaurantSettings);
router.put("/branches/update", authMiddleware, updateBranches);
router.put("/general/:id", authMiddleware, updateGeneralSettings);
router.post("/branches/create", authMiddleware, createBranch);

export default router;
