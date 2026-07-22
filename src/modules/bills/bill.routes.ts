import { Router } from "express";
import {
  createBill,
  getBranchWiseBills,
  getReportBills,
  cancelBill,
  createBillRefund,
  getBillRefunds,
} from "./bill.controller";
import { authMiddleware } from "../../middleware/auth";

const router = Router();

router.post("/create", authMiddleware, createBill);
router.get("/:restaurantId/:branchId/branchwise", authMiddleware, getBranchWiseBills);
// Raw bills with all financial fields — supports ?branchId= ?from= ?to=
router.get("/:restaurantId/restaurantwise", authMiddleware, getReportBills);
router.patch("/:billId/cancel", authMiddleware, cancelBill);
router.post("/:billId/refund", authMiddleware, createBillRefund);
router.get("/:billId/refunds", authMiddleware, getBillRefunds);

export default router;
