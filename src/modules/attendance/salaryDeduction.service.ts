import prisma from "../../config/prisma";
import { ForbiddenError } from "./attendance.validation";

// Salary deductions (ADVANCE | FINE | UNPAID_LEAVE | OTHER), scoped to a
// month/year — fed into payroll.service.ts's net pay calculation. Ownership
// enforced the same way as leave.service.ts / attendance.service.ts.

export const getSalaryDeductionsService = async (
  restaurantId: number,
  branchId: number,
  month?: number,
  year?: number,
) => {
  return prisma.salaryDeduction.findMany({
    where: {
      restaurantId,
      branchId,
      ...(month !== undefined ? { month } : {}),
      ...(year !== undefined ? { year } : {}),
    },
    include: {
      user: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
};

export const createSalaryDeductionService = async (
  callerRestaurantId: number,
  data: {
    userId: number;
    branchId: number;
    deductionType?: string;
    amount: number;
    month: number;
    year: number;
    notes?: string;
    createdById?: number;
  },
) => {
  const user = await prisma.user.findUnique({
    where: { id: data.userId },
    select: { restaurantId: true },
  });
  if (!user || user.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this employee");
  }

  return prisma.salaryDeduction.create({
    data: {
      userId: data.userId,
      restaurantId: callerRestaurantId,
      branchId: data.branchId,
      deductionType: data.deductionType || "OTHER",
      amount: Number(data.amount),
      month: Number(data.month),
      year: Number(data.year),
      notes: data.notes,
      createdById: data.createdById,
    },
  });
};

export const updateSalaryDeductionService = async (
  callerRestaurantId: number,
  id: number,
  data: Partial<{ deductionType: string; amount: number; notes: string }>,
) => {
  const existing = await prisma.salaryDeduction.findUnique({ where: { id } });
  if (!existing || existing.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this deduction");
  }

  return prisma.salaryDeduction.update({
    where: { id },
    data: {
      ...(data.deductionType !== undefined ? { deductionType: data.deductionType } : {}),
      ...(data.amount !== undefined ? { amount: Number(data.amount) } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
    },
  });
};

export const deleteSalaryDeductionService = async (
  callerRestaurantId: number,
  id: number,
) => {
  const existing = await prisma.salaryDeduction.findUnique({ where: { id } });
  if (!existing || existing.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this deduction");
  }

  return prisma.salaryDeduction.delete({ where: { id } });
};
