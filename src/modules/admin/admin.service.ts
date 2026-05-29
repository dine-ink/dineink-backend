import prisma from "../../config/prisma";

export const getTodayAttendanceService = async (branchId: number) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const users = await prisma.user.findMany({
    where: {
      branchId,
      isDeleted: false,
    },

    include: {
      attendances: {
        where: {
          date: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },

        include: {
          breaks: true,
        },
      },
    },
  });

  return users.map((user: any) => {
    const attendance = user.attendances?.[0];

    const totalBreakMinutes =
      attendance?.breaks?.reduce(
        (sum: number, item: any) => sum + (item.totalMinutes || 0),
        0,
      ) || 0;

    const activeBreak = attendance?.breaks?.find((item: any) => !item.endTime);

    return {
      id: user.id,
      name: user.name,

      restaurantId: user.restaurantId,
      branchId: user.branchId,

      attendanceId: attendance?.id || null,

      status: !!attendance?.loginTime && !attendance?.logoutTime,

      loginTime: attendance?.loginTime || null,

      logoutTime: attendance?.logoutTime || null,

      breakTime: totalBreakMinutes,

      totalHours: attendance?.totalHours || 0,

      onBreak: !!activeBreak,
    };
  });
};

export const loginAttendanceService = async (data: {
  userId: number;
  restaurantId: number;
  branchId: number;
}) => {
  const today = new Date();

  const startOfDay = new Date(today);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(today);
  endOfDay.setHours(23, 59, 59, 999);

  const existingAttendance = await prisma.attendance.findFirst({
    where: {
      userId: data.userId,

      date: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
  });

  if (existingAttendance) {
    throw new Error("Employee already logged in today");
  }

  return prisma.attendance.create({
    data: {
      userId: data.userId,
      restaurantId: data.restaurantId,
      branchId: data.branchId,

      date: startOfDay,

      loginTime: new Date(),

      status: "PRESENT",
    },
  });
};

export const logoutAttendanceService = async (attendanceId: number) => {
  const attendance = await prisma.attendance.findUnique({
    where: {
      id: attendanceId,
    },

    include: {
      breaks: true,
    },
  });

  if (!attendance) {
    throw new Error("Attendance not found");
  }

  if (!attendance.loginTime) {
    throw new Error("Employee not logged in");
  }

  const logoutTime = new Date();

  const totalBreakMinutes = attendance.breaks.reduce(
    (sum, item) => sum + (item.totalMinutes || 0),
    0,
  );

  const totalHours =
    (logoutTime.getTime() - attendance.loginTime.getTime()) / (1000 * 60 * 60) -
    totalBreakMinutes / 60;

  return prisma.attendance.update({
    where: {
      id: attendanceId,
    },

    data: {
      logoutTime,
      totalHours: Number(totalHours.toFixed(2)),
    },
  });
};

export const startBreakService = async (attendanceId: number) => {
  const attendance = await prisma.attendance.findUnique({
    where: {
      id: attendanceId,
    },
  });

  if (!attendance) {
    throw new Error("Attendance not found");
  }

  if (attendance.logoutTime) {
    throw new Error("Employee already logged out");
  }

  const activeBreak = await prisma.attendanceBreak.findFirst({
    where: {
      attendanceId,
      endTime: null,
    },
  });

  if (activeBreak) {
    throw new Error("Break already started");
  }

  return prisma.attendanceBreak.create({
    data: {
      attendanceId,

      startTime: new Date(),
    },
  });
};

export const endBreakService = async (attendanceId: number) => {
  const activeBreak = await prisma.attendanceBreak.findFirst({
    where: {
      attendanceId,
      endTime: null,
    },

    orderBy: {
      id: "desc",
    },
  });

  if (!activeBreak) {
    throw new Error("No active break found");
  }

  const endTime = new Date();

  const totalMinutes = Math.floor(
    (endTime.getTime() - activeBreak.startTime.getTime()) / 60000,
  );

  return prisma.attendanceBreak.update({
    where: {
      id: activeBreak.id,
    },

    data: {
      endTime,
      totalMinutes,
    },
  });
};
