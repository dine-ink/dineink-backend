import { Router } from "express";
import {
  getAttendanceByBranch,
  getMonthlyAttendance,
  upsertManualAttendance,
} from "./attendance.controller";
import {
  getLeaveRequests,
  createLeaveRequest,
  updateLeaveRequestStatus,
  deleteLeaveRequest,
} from "./leave.controller";
import {
  getSalaryDeductions,
  createSalaryDeduction,
  updateSalaryDeduction,
  deleteSalaryDeduction,
} from "./salaryDeduction.controller";
import { runPayroll, getPayrollRuns } from "./payroll.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnBranch, requireOwnRestaurant, requireRole } from "../../middleware/authorize";

const router = Router();

// GET /api/attendance/branch/:branchId?date=YYYY-MM-DD
// GET /api/attendance/branch/:branchId?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/branch/:branchId", authMiddleware, requireOwnBranch(), getAttendanceByBranch);

// GET /api/attendance/branch/:branchId/monthly?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/branch/:branchId/monthly", authMiddleware, requireOwnBranch(), getMonthlyAttendance);

// POST /api/attendance/manual — manager/owner-entered total hours / overtime
// override for one employee's one day. Body: { userId, restaurantId, branchId,
// date, manualTotalHours?, overtimeHours?, status? }
//
// requireRole is NOT redundant here: this route rewrites the hours a payroll
// run pays against, so without it any authenticated session — including a
// CASHIER's — could edit anyone's worked hours, their own included. Gated to
// match the salary-deduction routes below, which guard the same payroll inputs.
router.post("/manual", authMiddleware, requireRole("OWNER", "MANAGER"), upsertManualAttendance);

// --- Leave management -------------------------------------------------
// GET /api/attendance/leave/:restaurantId/:branchId?status=PENDING
router.get(
  "/leave/:restaurantId/:branchId",
  authMiddleware,
  requireOwnRestaurant(),
  requireOwnBranch(),
  getLeaveRequests,
);

// POST /api/attendance/leave — staff submit their own leave request.
// Body: { userId, branchId, leaveType?, startDate, endDate, reason? }
router.post("/leave", authMiddleware, createLeaveRequest);

// PATCH /api/attendance/leave/:id/status — approve/reject, OWNER/MANAGER only.
// Body: { status: "APPROVED" | "REJECTED" }
router.patch(
  "/leave/:id/status",
  authMiddleware,
  requireRole("OWNER", "MANAGER"),
  updateLeaveRequestStatus,
);

// DELETE /api/attendance/leave/:id — OWNER/MANAGER only.
router.delete("/leave/:id", authMiddleware, requireRole("OWNER", "MANAGER"), deleteLeaveRequest);

// --- Salary deductions --------------------------------------------------
// Financially sensitive — gated to OWNER/MANAGER on top of auth + ownership,
// same convention as emi.routes.ts.
// GET /api/attendance/deductions/:restaurantId/:branchId?month=&year=
router.get(
  "/deductions/:restaurantId/:branchId",
  authMiddleware,
  requireRole("OWNER", "MANAGER"),
  requireOwnRestaurant(),
  requireOwnBranch(),
  getSalaryDeductions,
);

// POST /api/attendance/deductions
// Body: { userId, branchId, deductionType?, amount, month, year, notes? }
router.post("/deductions", authMiddleware, requireRole("OWNER", "MANAGER"), createSalaryDeduction);

// PUT /api/attendance/deductions/:id
router.put("/deductions/:id", authMiddleware, requireRole("OWNER", "MANAGER"), updateSalaryDeduction);

// DELETE /api/attendance/deductions/:id
router.delete("/deductions/:id", authMiddleware, requireRole("OWNER", "MANAGER"), deleteSalaryDeduction);

// --- Payroll runs --------------------------------------------------------
// Financially sensitive — gated to OWNER/MANAGER, same as salary deductions.
// POST /api/attendance/payroll/run — Body: { branchId, month, year }
router.post("/payroll/run", authMiddleware, requireRole("OWNER", "MANAGER"), runPayroll);

// GET /api/attendance/payroll/:restaurantId/:branchId
router.get(
  "/payroll/:restaurantId/:branchId",
  authMiddleware,
  requireRole("OWNER", "MANAGER"),
  requireOwnRestaurant(),
  requireOwnBranch(),
  getPayrollRuns,
);

export default router;
