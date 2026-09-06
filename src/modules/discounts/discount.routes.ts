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
import { validateBody } from "../../middleware/validate";
import {
  createDiscountSchema,
  updateDiscountSchema,
  validateDiscountSchema,
} from "./discount.validation";

const router = Router();

// The write routes carry no `requireOwnRestaurant`, and correctly so: they have
// no restaurantId in the URL to compare against. The controller takes the
// caller's own from the JWT and each service refuses a row belonging to another
// restaurant, which is the stronger of the two checks because the client cannot
// influence it.
router.get("/:restaurantId", authMiddleware, requireOwnRestaurant(), getDiscountCodes);
router.post("/", authMiddleware, validateBody(createDiscountSchema), createDiscountCode);
router.put("/:id", authMiddleware, validateBody(updateDiscountSchema), updateDiscountCode);
router.delete("/:id", authMiddleware, deleteDiscountCode);
router.post("/validate", authMiddleware, validateBody(validateDiscountSchema), validateDiscountCode);

export default router;
