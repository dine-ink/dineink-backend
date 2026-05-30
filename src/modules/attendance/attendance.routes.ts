import { Router } from "express";
import { getAttendanceByBranch, getMonthlyAttendance } from "./attendance.controller";
import { authMiddleware } from "../../middleware/auth";

const router = Router();

// GET /api/attendance/branch/:branchId?date=YYYY-MM-DD
// GET /api/attendance/branch/:branchId?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/branch/:branchId", authMiddleware, getAttendanceByBranch);

// GET /api/attendance/branch/:branchId/monthly?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/branch/:branchId/monthly", authMiddleware, getMonthlyAttendance);

export default router;
