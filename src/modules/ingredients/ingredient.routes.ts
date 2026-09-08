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
import { validateBody } from "../../middleware/validate";
import { createVendorSchema, priceUpdateSchema, updateVendorSchema } from "./ingredient.validation";
import { requireOwnRestaurant } from "../../middleware/authorize";

const router = express.Router();

// These 3 (plus their /generate, /save aliases below) had no authMiddleware
// at all — any unauthenticated caller could read or overwrite any
// restaurant's ingredient list.
router.post("/generateIngredients", authMiddleware, generateIngredients);
router.post("/saveIngredients", authMiddleware, saveIngredients);
router.get("/:restaurantId/getRestaurantIngredients", authMiddleware, requireOwnRestaurant(), getIngredients);
router.get("/:restaurantId/reorder-alerts", authMiddleware, requireOwnRestaurant(), getReorderAlerts);
router.post("/ai-suggestIngredients", authMiddleware, aiSuggestMapping);
router.post("/uploadVendorData", authMiddleware, uploadVendors);
router.get("/:restaurantId/:branchId/fetchVendors", authMiddleware, requireOwnRestaurant(), getVendors);

// Vendor CRUD
// The schema is what stops a client-supplied restaurantId reaching
// prisma.vendor.update — see ingredient.validation.ts.
router.post("/vendors", authMiddleware, validateBody(createVendorSchema), createVendorHandler);
router.put("/vendors/:id", authMiddleware, validateBody(updateVendorSchema), updateVendorHandler);
router.delete("/vendors/:id", authMiddleware, deleteVendorHandler);
router.get("/vendors/:vendorId/ingredients", authMiddleware, getIngredientsByVendorHandler);

// Price history
router.post("/price-update", authMiddleware, validateBody(priceUpdateSchema), updateIngredientPriceHandler);
router.get("/price-history/:ingredientId", authMiddleware, getIngredientPriceHistoryHandler);

// Short aliases used by Insights page
router.post("/generate", authMiddleware, generateIngredients);
router.post("/save", authMiddleware, saveIngredients);

export default router;
