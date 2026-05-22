import { Router } from "express";

import {
  setupRestaurant,
  getShops,
  getMyRestaurant,
  getBranchDetails,
  updateBranchDetails,
  getRestaurantStaff,
  getTablesController,
} from "./restaurant.controller";

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

export default router;
