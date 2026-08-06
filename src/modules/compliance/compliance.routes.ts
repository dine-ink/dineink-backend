import express from "express";
import {
  getComplianceRecords,
  getComplianceSummary,
  createComplianceRecord,
  updateComplianceRecord,
  deleteComplianceRecord,
  uploadComplianceDocument,
} from "./compliance.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnRestaurant, requireOwnBranch, requireRole } from "../../middleware/authorize";
import { uploadDocument } from "../../middleware/upload";

const router = express.Router();

// Compliance Checker is an OWNER/MANAGER-facing feature — every route below
// is gated by role on top of the usual auth + tenant-ownership checks.
router.use(authMiddleware, requireRole("OWNER", "MANAGER"));

router.get("/:restaurantId/:branchId/summary", requireOwnRestaurant(), requireOwnBranch(), getComplianceSummary);
router.get("/:restaurantId/:branchId", requireOwnRestaurant(), requireOwnBranch(), getComplianceRecords);

router.post("/upload", uploadDocument.single("document"), uploadComplianceDocument);

router.post("/", createComplianceRecord);
router.put("/:id", updateComplianceRecord);
router.delete("/:id", deleteComplianceRecord);

export default router;
