import { Router } from "express";
import { createBill, getBills, getBranchWiseBills } from "./bill.controller";

const router = Router();
router.post("/create", createBill);
router.get("/:restaurantId/:branchId/branchwise", getBranchWiseBills);
router.get("/:id/restaurantwise", getBills);

export default router;
