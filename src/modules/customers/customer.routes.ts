import { Router } from "express";

import {
  getCustomersByBranch,
  getCustomersByRestaurant,
} from "./customer.controller";

const router = Router();

// branchId passed as query param: ?branchId=X (controller reads req.query.branchId)
router.get("/:restaurantId/customerByBranch", getCustomersByBranch);
router.get("/:id/customerByRestaurant", getCustomersByRestaurant);

export default router;
