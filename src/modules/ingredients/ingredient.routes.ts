import express from "express";
import {
  generateIngredients,
  saveIngredients,
  getIngredients,
  aiSuggestMapping,
} from "./ingredient.controller";
import { authMiddleware } from "../../middleware/auth";

const router = express.Router();

router.post("/generateIngredients", generateIngredients);
router.post("/saveIngredients", saveIngredients);
router.get("/restaurant/:restaurantId/getIngredients", getIngredients);
router.post(
  "/menu-item-mapping/ai-suggestIngredients",
  authMiddleware,
  aiSuggestMapping,
);

export default router;
