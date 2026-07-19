import express from "express";
import {
  generateIngredients,
  saveIngredients,
  getIngredients,
  aiSuggestMapping,
  uploadVendors,
  getVendors,
  createVendorHandler,
  updateVendorHandler,
  deleteVendorHandler,
  updateIngredientPriceHandler,
  getIngredientPriceHistoryHandler,
  getIngredientsByVendorHandler,
  getReorderAlerts,
} from "./ingredient.controller";
import { authMiddleware } from "../../middleware/auth";

const router = express.Router();

router.post("/generateIngredients", generateIngredients);
router.post("/saveIngredients", saveIngredients);
router.get("/:restaurantId/getRestaurantIngredients", getIngredients);
router.get("/:restaurantId/reorder-alerts", authMiddleware, getReorderAlerts);
router.post("/ai-suggestIngredients", authMiddleware, aiSuggestMapping);
router.post("/uploadVendorData", authMiddleware, uploadVendors);
router.get("/:restaurantId/:branchId/fetchVendors", authMiddleware, getVendors);

// Vendor CRUD
router.post("/vendors", authMiddleware, createVendorHandler);
router.put("/vendors/:id", authMiddleware, updateVendorHandler);
router.delete("/vendors/:id", authMiddleware, deleteVendorHandler);
router.get("/vendors/:vendorId/ingredients", authMiddleware, getIngredientsByVendorHandler);

// Price history
router.post("/price-update", authMiddleware, updateIngredientPriceHandler);
router.get("/price-history/:ingredientId", authMiddleware, getIngredientPriceHistoryHandler);

// Short aliases used by Insights page
router.post("/generate", generateIngredients);
router.post("/save", saveIngredients);

export default router;
