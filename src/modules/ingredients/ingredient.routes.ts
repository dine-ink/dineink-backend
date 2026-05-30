import express from "express";
import {
  generateIngredients,
  saveIngredients,
  getIngredients,
  aiSuggestMapping,
  uploadVendors,
  getVendors,
} from "./ingredient.controller";
import { authMiddleware } from "../../middleware/auth";

const router = express.Router();

router.post("/generateIngredients", generateIngredients);
router.post("/saveIngredients", saveIngredients);
router.get("/:restaurantId/getRestaurantIngredients", getIngredients);
router.post("/ai-suggestIngredients", authMiddleware, aiSuggestMapping);
router.post("/uploadVendorData", authMiddleware, uploadVendors);
router.get("/:restaurantId/:branchId/fetchVendors", authMiddleware, getVendors);

// Short aliases used by Insights page
router.post("/generate", generateIngredients);
router.post("/save", saveIngredients);

export default router;
