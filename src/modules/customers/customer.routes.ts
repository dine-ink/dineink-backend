import { Router } from "express";

import {
  getCustomersByBranch,
  getCustomersByRestaurant,
  lookupCustomerByPhone,
} from "./customer.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnRestaurant } from "../../middleware/authorize";

const router = Router();

// This module had no authMiddleware at all — customer PII (name/phone/visit
// history) was reachable by anyone, unauthenticated, for any restaurant.
// branchId passed as query param: ?branchId=X (controller reads req.query.branchId)
router.get("/:restaurantId/customerByBranch", authMiddleware, requireOwnRestaurant(), getCustomersByBranch);
router.get("/:id/customerByRestaurant", authMiddleware, requireOwnRestaurant("id"), getCustomersByRestaurant);
// Checkout-time lookup — GET /:restaurantId/lookup?phone=...
router.get("/:restaurantId/lookup", authMiddleware, requireOwnRestaurant(), lookupCustomerByPhone);

export default router;
