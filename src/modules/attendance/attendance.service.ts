import prisma from "../../config/prisma";

export const getAttendanceByBranchService = async (
  branchId: number,
  date?: string,
  from?: string,
  to?: string,
) => {
  let dateFilter: any = {};

  // Filtered by `date` (the day this record is for), not `loginTime` — a
  // manually-entered day (owner override, no POS clock-in at all) has a
  // null loginTime and would otherwise never match.
  if (date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    dateFilter = { date: { gte: start, lte: end } };
  } else if (from && to) {
    dateFilter = {
      date: {
        gte: new Date(from),
        lte: new Date(to + "T23:59:59.999Z"),
      },
    };
  } else {
    // Default: today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    dateFilter = { date: { gte: today, lte: todayEnd } };
  }

  return prisma.attendance.findMany({
    where: { branchId, ...dateFilter },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          department: true,
          salary: true,
          shift: true,
          employmentType: true,
        },
      },
      breaks: {
        select: {
          id: true,
          startTime: true,
          endTime: true,
          totalMinutes: true,
          reason: true,
        },
        orderBy: { startTime: "asc" },
      },
    },
    orderBy: { loginTime: "desc" },
  });
};

export const getMonthlyAttendanceService = async (
  branchId: number,
  from: string,
  to: string,
) => {
  return prisma.attendance.findMany({
    where: {
      branchId,
      date: {
        gte: new Date(from),
        lte: new Date(to + "T23:59:59.999Z"),
      },
    },
    include: {
      user: { select: { id: true, name: true, department: true } },
      breaks: { select: { totalMinutes: true } },
    },
    orderBy: { date: "asc" },
  });
};

// Owner-entered override for a single employee's single day: sets the
// effective total hours (independent of whatever the POS clock-in/out
// computed) and/or overtime hours. Upserts on the same (userId, date) row
// the POS app uses, normalizing `date` to local midnight the same way
// loginAttendanceService does, so editing an existing day updates that row
// instead of creating a duplicate.
export const upsertManualAttendanceService = async (data: {
  userId: number;
  restaurantId: number;
  branchId: number;
  date: string; // "YYYY-MM-DD"
  manualTotalHours?: number | null;
  overtimeHours?: number;
  status?: string;
}) => {
  const day = new Date(data.date);
  day.setHours(0, 0, 0, 0);

  const manualTotalHours =
    data.manualTotalHours === undefined || data.manualTotalHours === null
      ? null
      : Number(data.manualTotalHours);
  const overtimeHours = data.overtimeHours != null ? Number(data.overtimeHours) : 0;

  return prisma.attendance.upsert({
    where: { userId_date: { userId: data.userId, date: day } },
    update: {
      manualTotalHours,
      overtimeHours,
      ...(data.status ? { status: data.status } : {}),
    },
    create: {
      userId: data.userId,
      restaurantId: data.restaurantId,
      branchId: data.branchId,
      date: day,
      manualTotalHours,
      overtimeHours,
      status: data.status || "PRESENT",
    },
  });
};
