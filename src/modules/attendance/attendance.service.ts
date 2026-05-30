import prisma from "../../config/prisma";

export const getAttendanceByBranchService = async (
  branchId: number,
  date?: string,
  from?: string,
  to?: string,
) => {
  let dateFilter: any = {};

  if (date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    dateFilter = { loginTime: { gte: start, lte: end } };
  } else if (from && to) {
    dateFilter = {
      loginTime: {
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
    dateFilter = { loginTime: { gte: today, lte: todayEnd } };
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
      loginTime: {
        gte: new Date(from),
        lte: new Date(to + "T23:59:59.999Z"),
      },
    },
    include: {
      user: { select: { id: true, name: true, department: true } },
      breaks: { select: { totalMinutes: true } },
    },
    orderBy: { loginTime: "asc" },
  });
};
