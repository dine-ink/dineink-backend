import { Router } from "express";
import {
  getAttendanceByBranch,
  getMonthlyAttendance,
  upsertManualAttendance,
} from "./attendance.controller";
import { authMiddleware } from "../../middleware/auth";

const router = Router();

// GET /api/attendance/branch/:branchId?date=YYYY-MM-DD
// GET /api/attendance/branch/:branchId?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/branch/:branchId", authMiddleware, getAttendanceByBranch);

// GET /api/attendance/branch/:branchId/monthly?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/branch/:branchId/monthly", authMiddleware, getMonthlyAttendance);

// POST /api/attendance/manual — owner-entered total hours / overtime override
// for one employee's one day. Body: { userId, restaurantId, branchId, date,
// manualTotalHours?, overtimeHours?, status? }
router.post("/manual", authMiddleware, upsertManualAttendance);

export default router;
