import prisma from "../../config/prisma";
import { ForbiddenError } from "./attendance.validation";
import { computeStandardShiftHours, computeOvertimeCost } from "../finance/finance.formulas";

// Payroll run: for every active, salaried user of a branch, sums that
// month's Attendance.overtimeHours and SalaryDeduction.amount, then derives
// overtime pay via finance.formulas.ts's computeStandardShiftHours /
// computeOvertimeCost (the single source of truth for overtime math — reused
// here rather than reimplemented) to land on baseSalary + overtimePay -
// deductions = netPay per employee, and totalPayout across the run.

export const runPayrollService = async (
  callerRestaurantId: number,
  branchId: number,
  month: number,
  year: number,
  generatedById?: number,
) => {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: {
      restaurantId: true,
      morningShiftHours: true,
      eveningShiftHours: true,
      fullDayShiftHours: true,
      overtimeRateMultiplier: true,
    },
  });
  if (!branch || branch.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this branch");
  }

  const users = await prisma.user.findMany({
    where: {
      branchId,
      restaurantId: callerRestaurantId,
      isActive: true,
      isDeleted: false,
      salary: { not: null },
    },
    select: { id: true, name: true, salary: true, shift: true },
  });

  // Month/year date range, matching the local-midnight-to-end-of-day pattern
  // used elsewhere in this module (attendance.service.ts).
  const periodStart = new Date(year, month - 1, 1);
  periodStart.setHours(0, 0, 0, 0);
  const periodEnd = new Date(year, month, 0);
  periodEnd.setHours(23, 59, 59, 999);

  const payrollPolicy = {
    morningShiftHours: branch.morningShiftHours || 6,
    eveningShiftHours: branch.eveningShiftHours || 6,
    fullDayShiftHours: branch.fullDayShiftHours || 10,
  };
  const overtimeRateMultiplier = branch.overtimeRateMultiplier || 1.5;

  const lines: {
    userId: number;
    baseSalary: number;
    overtimePay: number;
    deductions: number;
    netPay: number;
  }[] = [];

  for (const user of users) {
    const baseSalary = user.salary || 0;

    const overtimeAgg = await prisma.attendance.aggregate({
      where: { userId: user.id, date: { gte: periodStart, lte: periodEnd } },
      _sum: { overtimeHours: true },
    });
    const totalOvertimeHours = overtimeAgg._sum.overtimeHours || 0;

    const standardShiftHours = computeStandardShiftHours(user.shift, payrollPolicy);
    const overtimePay = computeOvertimeCost(
      baseSalary,
      standardShiftHours,
      totalOvertimeHours,
      overtimeRateMultiplier,
    );

    const deductionAgg = await prisma.salaryDeduction.aggregate({
      where: { userId: user.id, month, year },
      _sum: { amount: true },
    });
    const deductions = deductionAgg._sum.amount || 0;

    const netPay = baseSalary + overtimePay - deductions;

    lines.push({ userId: user.id, baseSalary, overtimePay, deductions, netPay });
  }

  const totalPayout = lines.reduce((sum, l) => sum + l.netPay, 0);

  const existing = await prisma.payrollRun.findUnique({
    where: { branchId_month_year: { branchId, month, year } },
  });

  // PayrollRunLine has no unique constraint to upsert against individually,
  // so re-running payroll for a branch/month/year that was already processed
  // deletes the stale lines and recreates them fresh, inside a transaction
  // so the run is never left with a partial line set.
  return prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.payrollRunLine.deleteMany({ where: { payrollRunId: existing.id } });
      return tx.payrollRun.update({
        where: { id: existing.id },
        data: {
          status: "PROCESSED",
          totalPayout,
          generatedById,
          lines: { create: lines },
        },
        include: { lines: { include: { user: { select: { id: true, name: true } } } } },
      });
    }

    return tx.payrollRun.create({
      data: {
        restaurantId: callerRestaurantId,
        branchId,
        month,
        year,
        status: "PROCESSED",
        totalPayout,
        generatedById,
        lines: { create: lines },
      },
      include: { lines: { include: { user: { select: { id: true, name: true } } } } },
    });
  });
};

export const getPayrollRunsService = async (restaurantId: number, branchId: number) => {
  return prisma.payrollRun.findMany({
    where: { restaurantId, branchId },
    include: {
      lines: { include: { user: { select: { id: true, name: true } } } },
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
};
