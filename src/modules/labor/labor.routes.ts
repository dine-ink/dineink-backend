import express from "express";
import {
  applyCalibration,
  assignEquipment,
  bulkUpsertLaborStandards,
  createStation,
  deleteLaborStandard,
  deleteSkill,
  deleteStation,
  getCalibration,
  getCapacitySweep,
  getLaborStandards,
  getSkillMatrix,
  getStaffingPlan,
  getStations,
  seedStandardsFromPrepTime,
  seedStations,
  updateStation,
  upsertLaborStandard,
  upsertSkill,
} from "./labor.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnBranch, requireOwnRestaurant, requireRole } from "../../middleware/authorize";

const router = express.Router();

// Gated to OWNER/MANAGER on top of the usual auth + tenant-ownership checks.
// This module exposes individual salaries (via the staffing plan's labor cost),
// per-employee capability ratings and per-employee throughput figures — the same
// sensitivity that already gates the equipment and emi modules.
router.use(authMiddleware, requireRole("OWNER", "MANAGER"));

// Read routes carry :restaurantId/:branchId and are gated by both middlewares.
// Write routes take the row's own id and re-check ownership inside the service
// (throwing ForbiddenError → 403), matching equipment.routes.ts exactly.
router.get("/:restaurantId/:branchId/stations", requireOwnRestaurant(), requireOwnBranch(), getStations);
router.get("/:restaurantId/:branchId/standards", requireOwnRestaurant(), requireOwnBranch(), getLaborStandards);
router.get("/:restaurantId/:branchId/skills", requireOwnRestaurant(), requireOwnBranch(), getSkillMatrix);
router.get("/:restaurantId/:branchId/staffing-plan", requireOwnRestaurant(), requireOwnBranch(), getStaffingPlan);
router.get("/:restaurantId/:branchId/capacity-sweep", requireOwnRestaurant(), requireOwnBranch(), getCapacitySweep);
router.get("/:restaurantId/:branchId/calibration", requireOwnRestaurant(), requireOwnBranch(), getCalibration);
router.post("/:restaurantId/:branchId/calibration/apply", requireOwnRestaurant(), requireOwnBranch(), applyCalibration);

router.post("/stations", createStation);
router.post("/stations/seed", seedStations);
router.put("/stations/:stationId", updateStation);
router.delete("/stations/:stationId", deleteStation);
router.put("/equipment/:equipmentId/station", assignEquipment);

router.post("/standards", upsertLaborStandard);
router.post("/standards/bulk", bulkUpsertLaborStandards);
router.post("/standards/seed-from-prep-time", seedStandardsFromPrepTime);
router.delete("/standards/:menuItemId/:stationId", deleteLaborStandard);

router.post("/skills", upsertSkill);
router.delete("/skills/:userId/:stationId", deleteSkill);

export default router;
