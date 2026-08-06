import prisma from "../../config/prisma";
import { ForbiddenError } from "./emi.validation";

// ── EMI Schedules ─────────────────────────────────────────────────────────────

export const getEmiSchedulesService = async (restaurantId: number, branchId?: number) => {
  return prisma.emiSchedule.findMany({
    where: {
      restaurantId,
      // branchId omitted entirely means "all branches"; a branchId of null
      // in the schema means "restaurant-wide" — these are different filters,
      // so only add the clause when the caller actually asked for one branch.
      ...(branchId !== undefined ? { branchId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
};

export const createEmiScheduleService = async (
  callerRestaurantId: number,
  data: {
    branchId?: number | null;
    name: string;
    principalAmount: number;
    emiAmount: number;
    dueDayOfMonth: number;
    startDate: string;
    tenureMonths: number;
    notes?: string;
    createdById?: number;
  },
) => {
  return prisma.emiSchedule.create({
    data: {
      restaurantId:    callerRestaurantId,
      branchId:        data.branchId ?? null,
      name:            data.name,
      principalAmount: data.principalAmount,
      emiAmount:       data.emiAmount,
      dueDayOfMonth:   data.dueDayOfMonth,
      startDate:       new Date(data.startDate),
      tenureMonths:    data.tenureMonths,
      notes:           data.notes,
      createdById:     data.createdById,
    },
  });
};

export const updateEmiScheduleService = async (
  callerRestaurantId: number,
  id: number,
  data: Partial<{
    branchId: number | null;
    name: string;
    principalAmount: number;
    emiAmount: number;
    dueDayOfMonth: number;
    startDate: string;
    tenureMonths: number;
    notes: string;
    isActive: boolean;
  }>,
) => {
  const existing = await prisma.emiSchedule.findUnique({ where: { id }, select: { restaurantId: true } });
  if (!existing) throw new Error("EMI schedule not found");
  if (existing.restaurantId !== callerRestaurantId) throw new ForbiddenError("You do not have access to this EMI schedule");

  const { startDate, ...rest } = data;
  return prisma.emiSchedule.update({
    where: { id },
    data: {
      ...rest,
      ...(startDate !== undefined ? { startDate: new Date(startDate) } : {}),
    },
  });
};

export const deleteEmiScheduleService = async (callerRestaurantId: number, id: number) => {
  const existing = await prisma.emiSchedule.findUnique({ where: { id }, select: { restaurantId: true } });
  if (!existing) throw new Error("EMI schedule not found");
  if (existing.restaurantId !== callerRestaurantId) throw new ForbiddenError("You do not have access to this EMI schedule");
  return prisma.emiSchedule.delete({ where: { id } });
};

// ── Upcoming dues (shared building block for Cash Flow Predictor / Dues Tracker) ─
//
// EmiSchedule only stores a recurring dueDayOfMonth, not individual due-date
// rows, so "which EMIs are due between these two dates" has to be computed by
// walking each calendar month the range touches and reconstructing the actual
// due Date for that month from dueDayOfMonth (clamped to the month's real
// last day, e.g. dueDayOfMonth=31 falls on Feb 28/29). A schedule only
// contributes a due date for months still inside its tenure — i.e. the
// number of months elapsed since startDate is less than tenureMonths — so
// EMIs that haven't started yet or have already been fully paid off are
// excluded.

export const getUpcomingEmiDuesService = async (
  restaurantId: number,
  branchId: number | undefined,
  fromDate: Date,
  toDate: Date,
) => {
  const schedules = await prisma.emiSchedule.findMany({
    where: {
      restaurantId,
      isActive: true,
      ...(branchId !== undefined ? { branchId } : {}),
    },
  });

  const results: Array<(typeof schedules)[number] & { dueDate: Date }> = [];

  const rangeStartMonth = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
  const rangeEndMonth = new Date(toDate.getFullYear(), toDate.getMonth(), 1);

  for (const schedule of schedules) {
    const start = new Date(schedule.startDate);
    const startMonth = new Date(start.getFullYear(), start.getMonth(), 1);

    // Walk month-by-month across the requested range — a schedule can have
    // at most one due date per calendar month, so this bounds the loop to
    // the number of months in [fromDate, toDate] rather than every day.
    const cursor = new Date(rangeStartMonth);
    while (cursor <= rangeEndMonth) {
      // Negative means the schedule hasn't started yet as of this month;
      // >= tenureMonths means the EMI has already been fully paid off.
      const monthsElapsed =
        (cursor.getFullYear() - startMonth.getFullYear()) * 12 +
        (cursor.getMonth() - startMonth.getMonth());

      if (monthsElapsed >= 0 && monthsElapsed < schedule.tenureMonths) {
        const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
        const day = Math.min(schedule.dueDayOfMonth, daysInMonth);
        const dueDate = new Date(cursor.getFullYear(), cursor.getMonth(), day);

        if (dueDate >= fromDate && dueDate <= toDate) {
          results.push({ ...schedule, dueDate });
        }
      }

      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  return results.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
};
