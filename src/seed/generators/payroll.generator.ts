import type { Branch, LeaveRequest, PayrollRun, PayrollRunLine, Prisma, SalaryDeduction, User } from "../../../generated/prisma";
import { computeOvertimeCost, computeStandardShiftHours } from "../../modules/finance/finance.formulas";
import type { SeedConfig } from "../config";
import type { SeedContext } from "../context";
import {
  addDays,
  batchCreateManyAndReturn,
  chance,
  type Db,
  historyDateRange,
  historyMonths,
  pickOne,
  randomFloat,
  randomInt,
  randomMoney,
  subDays,
  toUtcMidnight,
  weightedPick,
} from "../utils";

export interface PayrollSeedResult {
  leaveRequests: LeaveRequest[];
  salaryDeductions: SalaryDeduction[];
  payrollRuns: PayrollRun[];
  payrollRunLines: PayrollRunLine[];
}

// ─── LeaveRequest ────────────────────────────────────────────────────────

const LEAVE_TYPE_MIX = { CASUAL: 0.45, SICK: 0.35, EARNED: 0.15, UNPAID: 0.05 };

const LEAVE_REASONS: Record<keyof typeof LEAVE_TYPE_MIX, string[]> = {
  CASUAL: ["Family function", "Personal work", "Out of town", "Festival celebration"],
  SICK: ["Fever", "Not feeling well", "Doctor's appointment", "Viral infection"],
  EARNED: ["Family vacation", "Planned trip", "Personal leave"],
  UNPAID: ["Extended personal leave", "Family emergency"],
};

// A leave request dated within this many days of "now" is treated as
// recent/upcoming — only those are allowed to still be PENDING; anything
// older has necessarily already been approved or rejected by now.
const RECENT_PENDING_WINDOW_DAYS = 5;

/** How many LeaveRequest rows to create per staff member — hardcoded here (not config.ts) per the task's scope limit. */
const LEAVE_REQUESTS_PER_STAFF: [number, number] = [1, 4];

function findManagerId(staff: User[]): number | null {
  return staff.find((s) => s.role === "MANAGER")?.id ?? null;
}

function planLeaveRequestsForUser(
  user: User,
  branchId: number,
  restaurantId: number,
  managerId: number | null,
  candidateDays: Date[],
  anchor: Date,
): Prisma.LeaveRequestCreateManyInput[] {
  const count = randomInt(LEAVE_REQUESTS_PER_STAFF[0], LEAVE_REQUESTS_PER_STAFF[1]);
  const rows: Prisma.LeaveRequestCreateManyInput[] = [];

  for (let i = 0; i < count; i++) {
    const leaveType = weightedPick(LEAVE_TYPE_MIX);
    const startDate = toUtcMidnight(pickOne(candidateDays));
    const durationDays = randomInt(1, 4);
    const endDate = toUtcMidnight(addDays(startDate, durationDays - 1));

    const isRecent = endDate.getTime() >= toUtcMidnight(subDays(anchor, RECENT_PENDING_WINDOW_DAYS)).getTime();
    const status = isRecent
      ? weightedPick({ PENDING: 0.5, APPROVED: 0.35, REJECTED: 0.15 })
      : weightedPick({ PENDING: 0, APPROVED: 0.85, REJECTED: 0.15 });

    rows.push({
      userId: user.id,
      restaurantId,
      branchId,
      leaveType,
      startDate,
      endDate,
      reason: chance(0.6) ? pickOne(LEAVE_REASONS[leaveType]) : null,
      status,
      approvedById: status === "PENDING" ? null : managerId,
    });
  }

  return rows;
}

// ─── SalaryDeduction ────────────────────────────────────────────────────

/** Fraction of (staff x month) combinations that get a deduction row. */
const DEDUCTION_PROBABILITY = 0.12;

const DEDUCTION_TYPE_MIX_NORMAL = { ADVANCE: 0.4, FINE: 0.4, OTHER: 0.2 };
const DEDUCTION_TYPE_MIX_WITH_UNPAID_LEAVE = { ADVANCE: 0.35, FINE: 0.35, OTHER: 0.2, UNPAID_LEAVE: 0.1 };

const DEDUCTION_NOTES: Record<string, string[]> = {
  ADVANCE: ["Salary advance requested", "Advance against next month's salary"],
  FINE: ["Late arrival fine", "Uniform/grooming violation", "SOP checklist non-compliance"],
  OTHER: ["Loan repayment deduction", "Uniform cost recovery", "Equipment damage recovery"],
  UNPAID_LEAVE: ["Unpaid leave deduction"],
};

function deductionAmountFor(deductionType: string): number {
  if (deductionType === "FINE") return randomMoney(200, 3000);
  if (deductionType === "UNPAID_LEAVE") return randomMoney(500, 4000);
  return randomMoney(1000, 8000); // ADVANCE | OTHER
}

/** `${userId}:${month}:${year}` -> true if that user has an UNPAID LeaveRequest starting in that month, for a loose (not exact) correlation with SalaryDeduction.UNPAID_LEAVE rows. */
function buildUnpaidLeaveLookup(leaveRequests: Prisma.LeaveRequestCreateManyInput[]): Set<string> {
  const set = new Set<string>();
  for (const lr of leaveRequests) {
    if (lr.leaveType !== "UNPAID") continue;
    const start = lr.startDate as Date;
    set.add(`${lr.userId}:${start.getUTCMonth() + 1}:${start.getUTCFullYear()}`);
  }
  return set;
}

// ─── PayrollRun / PayrollRunLine ────────────────────────────────────────

// Fallback monthly salary by role, used only if a seeded User somehow has no
// `salary` set (user.generator.ts always sets one via SALARY_RANGES, so this
// is a defensive default, not the normal path).
const FALLBACK_SALARY_BY_ROLE: Record<string, number> = {
  MANAGER: 45000,
  CASHIER: 19000,
  CHEF: 28000,
  WAITER: 15000,
  CLEANING: 13000,
};

// If no Attendance rows exist at all (defensive fallback — the pipeline
// always runs the People phase, which owns Attendance, before Payroll), an
// overtime pay figure is still needed: a small random slice of base salary
// instead of a real overtimeHours-derived number.
const FALLBACK_OVERTIME_PCT_RANGE: [number, number] = [0, 0.08];

interface AttendanceOvertimeRow {
  userId: number;
  date: Date;
  overtimeHours: number | null;
}

function buildOvertimeHoursByUserMonth(rows: AttendanceOvertimeRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.userId}:${row.date.getUTCMonth() + 1}:${row.date.getUTCFullYear()}`;
    map.set(key, (map.get(key) ?? 0) + (row.overtimeHours ?? 0));
  }
  return map;
}

function payrollPolicyFor(branch: Branch): { morningShiftHours: number; eveningShiftHours: number; fullDayShiftHours: number } {
  return {
    morningShiftHours: branch.morningShiftHours ?? 6,
    eveningShiftHours: branch.eveningShiftHours ?? 6,
    fullDayShiftHours: branch.fullDayShiftHours ?? 10,
  };
}

/**
 * Owns: LeaveRequest, SalaryDeduction, PayrollRun, and PayrollRunLine — a
 * full monthly payroll history per branch over the seeded history window,
 * consistent with whatever Attendance/overtime data the People phase
 * already produced (falls back to a small random overtime figure only if no
 * Attendance rows exist at all — see FALLBACK_OVERTIME_PCT_RANGE below).
 *
 * Idempotent: checked via a single count() on PayrollRun (coarse-grained
 * across all four owned models, same pattern bill.generator.ts uses for its
 * many owned models) — if any PayrollRun already exists for this
 * restaurant's branches, returns early with empty arrays for all four.
 */
export async function generatePayrollData(db: Db, config: SeedConfig, ctx: SeedContext): Promise<PayrollSeedResult> {
  const existingCount = await db.payrollRun.count({ where: { restaurantId: ctx.restaurant.id } });
  if (existingCount > 0) {
    return { leaveRequests: [], salaryDeductions: [], payrollRuns: [], payrollRunLines: [] };
  }

  const anchor = new Date();
  const candidateDays = historyDateRange(config.history.monthsOfHistory, anchor);
  const months = historyMonths(config.history.monthsOfHistory, anchor);

  // ─── LeaveRequest ───
  const leaveRequestRows: Prisma.LeaveRequestCreateManyInput[] = [];
  for (const branchCtx of ctx.branches) {
    const managerId = findManagerId(branchCtx.staff);
    for (const user of branchCtx.staff) {
      leaveRequestRows.push(
        ...planLeaveRequestsForUser(user, branchCtx.branch.id, ctx.restaurant.id, managerId, candidateDays, anchor),
      );
    }
  }
  const leaveRequests = await batchCreateManyAndReturn(leaveRequestRows, (chunk) =>
    db.leaveRequest.createManyAndReturn({ data: chunk }),
  );

  const unpaidLeaveLookup = buildUnpaidLeaveLookup(leaveRequestRows);

  // ─── SalaryDeduction ───
  const salaryDeductionRows: Prisma.SalaryDeductionCreateManyInput[] = [];
  for (const branchCtx of ctx.branches) {
    const managerId = findManagerId(branchCtx.staff) ?? ctx.owner.id;
    for (const user of branchCtx.staff) {
      for (const { month, year } of months) {
        if (!chance(DEDUCTION_PROBABILITY)) continue;

        const eligibleForUnpaidLeave = unpaidLeaveLookup.has(`${user.id}:${month}:${year}`);
        const deductionType = weightedPick(
          eligibleForUnpaidLeave ? DEDUCTION_TYPE_MIX_WITH_UNPAID_LEAVE : DEDUCTION_TYPE_MIX_NORMAL,
        );

        salaryDeductionRows.push({
          userId: user.id,
          restaurantId: ctx.restaurant.id,
          branchId: branchCtx.branch.id,
          deductionType,
          amount: deductionAmountFor(deductionType),
          month,
          year,
          notes: chance(0.5) ? pickOne(DEDUCTION_NOTES[deductionType] ?? DEDUCTION_NOTES.OTHER) : null,
          createdById: managerId,
        });
      }
    }
  }
  const salaryDeductions = await batchCreateManyAndReturn(salaryDeductionRows, (chunk) =>
    db.salaryDeduction.createManyAndReturn({ data: chunk }),
  );

  const deductionTotalByUserMonth = new Map<string, number>();
  for (const sd of salaryDeductions) {
    const key = `${sd.userId}:${sd.month}:${sd.year}`;
    deductionTotalByUserMonth.set(key, (deductionTotalByUserMonth.get(key) ?? 0) + sd.amount);
  }

  // Real Attendance rows are expected to already exist by the time this
  // generator runs (People phase, which owns Attendance, runs before
  // Payroll in the pipeline) — checked once, cheaply, rather than assumed.
  const attendanceExists = (await db.attendance.count({ where: { restaurantId: ctx.restaurant.id } })) > 0;

  // ─── PayrollRun + PayrollRunLine ───
  const payrollRuns: PayrollRun[] = [];
  const payrollRunLines: PayrollRunLine[] = [];

  for (const branchCtx of ctx.branches) {
    const { branch, staff } = branchCtx;
    const payrollPolicy = payrollPolicyFor(branch);
    const overtimeRateMultiplier = branch.overtimeRateMultiplier ?? 1.5;

    let overtimeHoursByUserMonth = new Map<string, number>();
    if (attendanceExists) {
      const attendanceRows = await db.attendance.findMany({
        where: { branchId: branch.id, restaurantId: ctx.restaurant.id },
        select: { userId: true, date: true, overtimeHours: true },
      });
      overtimeHoursByUserMonth = buildOvertimeHoursByUserMonth(attendanceRows);
    }

    for (const { month, year } of months) {
      const lineInputs: Prisma.PayrollRunLineCreateManyInput[] = [];
      let totalPayout = 0;

      for (const user of staff) {
        const baseSalary = user.salary ?? FALLBACK_SALARY_BY_ROLE[user.role] ?? 15000;
        const monthKey = `${user.id}:${month}:${year}`;

        let overtimePay: number;
        if (attendanceExists) {
          const overtimeHours = overtimeHoursByUserMonth.get(monthKey) ?? 0;
          const standardShiftHours = computeStandardShiftHours(user.shift, payrollPolicy);
          overtimePay = computeOvertimeCost(baseSalary, standardShiftHours, overtimeHours, overtimeRateMultiplier);
        } else {
          // No Attendance data to derive real overtime from — see
          // FALLBACK_OVERTIME_PCT_RANGE comment above.
          overtimePay = Math.round(baseSalary * randomFloat(FALLBACK_OVERTIME_PCT_RANGE[0], FALLBACK_OVERTIME_PCT_RANGE[1]));
        }

        const deductions = deductionTotalByUserMonth.get(monthKey) ?? 0;
        const netPay = Math.round((baseSalary + overtimePay - deductions) * 100) / 100;
        totalPayout += netPay;

        lineInputs.push({ payrollRunId: 0, userId: user.id, baseSalary, overtimePay, deductions, netPay });
      }

      const payrollRun = await db.payrollRun.create({
        data: {
          restaurantId: ctx.restaurant.id,
          branchId: branch.id,
          month,
          year,
          status: "PROCESSED",
          totalPayout: Math.round(totalPayout * 100) / 100,
          generatedById: ctx.owner.id,
        },
      });
      payrollRuns.push(payrollRun);

      const lines = await batchCreateManyAndReturn(
        lineInputs.map((line) => ({ ...line, payrollRunId: payrollRun.id })),
        (chunk) => db.payrollRunLine.createManyAndReturn({ data: chunk }),
      );
      payrollRunLines.push(...lines);
    }
  }

  return { leaveRequests, salaryDeductions, payrollRuns, payrollRunLines };
}
