import { Router } from "express";
import {
  getDiscountCodes,
  createDiscountCode,
  updateDiscountCode,
  deleteDiscountCode,
  validateDiscountCode,
} from "./discount.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnRestaurant } from "../../middleware/authorize";

const router = Router();

router.get("/:restaurantId", authMiddleware, requireOwnRestaurant(), getDiscountCodes);
router.post("/", authMiddleware, createDiscountCode);
router.put("/:id", authMiddleware, updateDiscountCode);
router.delete("/:id", authMiddleware, deleteDiscountCode);
router.post("/validate", authMiddleware, validateDiscountCode);

export default router;
