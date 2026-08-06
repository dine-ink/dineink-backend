import express from "express";
import {
  getEmiSchedules,
  createEmiSchedule,
  updateEmiSchedule,
  deleteEmiSchedule,
} from "./emi.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnRestaurant, requireRole } from "../../middleware/authorize";

const router = express.Router();

// EMI schedules are financially sensitive (loan principal/EMI amounts) and,
// per project decision, this module is gated to OWNER/MANAGER roles on top
// of the usual auth + tenant-ownership checks.
router.use(authMiddleware, requireRole("OWNER", "MANAGER"));

router.get("/:restaurantId", requireOwnRestaurant(), getEmiSchedules);
router.post("/", createEmiSchedule);
router.put("/:id", updateEmiSchedule);
router.delete("/:id", deleteEmiSchedule);

export default router;
