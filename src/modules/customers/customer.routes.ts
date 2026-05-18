import { Router } from "express";

import {
  getCustomersByBranch,
  getCustomersByRestaurant,
} from "./customer.controller";

const router = Router();

router.get("/:id/customerByBranch", getCustomersByBranch);

router.get("/:id/customerByRestaurant", getCustomersByRestaurant);

export default router;
