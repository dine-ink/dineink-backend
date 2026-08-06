import express from "express";
import {
  getEquipmentList,
  createEquipment,
  updateEquipment,
  deleteEquipment,
  getMaintenanceDue,
} from "./equipment.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnRestaurant, requireOwnBranch, requireRole } from "../../middleware/authorize";

const router = express.Router();

// Equipment/asset data (capacity, power draw, EMI linkage, maintenance
// schedule) is financially and operationally sensitive, and per project
// decision this module is gated to OWNER/MANAGER roles on top of the usual
// auth + tenant-ownership checks — mirrors the emi module's gating.
router.use(authMiddleware, requireRole("OWNER", "MANAGER"));

router.get("/:restaurantId/:branchId", requireOwnRestaurant(), requireOwnBranch(), getEquipmentList);
router.get(
  "/:restaurantId/:branchId/maintenance-due",
  requireOwnRestaurant(),
  requireOwnBranch(),
  getMaintenanceDue,
);
router.post("/", createEquipment);
router.put("/:id", updateEquipment);
router.delete("/:id", deleteEquipment);

export default router;
