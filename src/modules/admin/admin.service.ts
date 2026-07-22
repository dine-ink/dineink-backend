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
      },
    },
  });

  return users.map((user: any) => {
    const attendance = user.attendances?.[0];

    return {
      id: user.id,
      name: user.name,

      restaurantId: user.restaurantId,
      branchId: user.branchId,

      attendanceId: attendance?.id || null,

      status: !!attendance?.loginTime && !attendance?.logoutTime,

      loginTime: attendance?.loginTime || null,

      logoutTime: attendance?.logoutTime || null,

      totalHours: attendance?.totalHours || 0,
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
  });

  if (!attendance) {
    throw new Error("Attendance not found");
  }

  if (!attendance.loginTime) {
    throw new Error("Employee not logged in");
  }

  const logoutTime = new Date();

  const totalHours =
    (logoutTime.getTime() - attendance.loginTime.getTime()) / (1000 * 60 * 60);

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

export const getExpensesService = async (branchId: number) => {
  return prisma.shopExpense.findMany({
    where: {
      branchId,
    },

    include: {
      paidByUser: {
        select: {
          id: true,
          name: true,
        },
      },
    },

    orderBy: {
      expenseDate: "desc",
    },
  });
};

export const getExpenseUsersService = async (branchId: number) => {
  return prisma.user.findMany({
    where: {
      branchId,
      isDeleted: false,
    },

    select: {
      id: true,
      name: true,
    },

    orderBy: {
      name: "asc",
    },
  });
};

export const createExpenseService = async (data: any) => {
  return prisma.shopExpense.create({
    data: {
      restaurantId: data.restaurantId,

      branchId: data.branchId,

      title: data.title,

      description: data.description,

      amount: Number(data.amount),

      expenseType: data.expenseType,

      paymentSource: data.paymentSource,

      paidByUserId:
        data.paymentSource === "EMPLOYEE_PAID"
          ? Number(data.paidByUserId)
          : null,

      expenseDate: new Date(data.expenseDate),

      createdById: data.createdById,
    },
  });
};

export const updateExpenseService = async (id: number, data: any) => {
  return prisma.shopExpense.update({
    where: {
      id,
    },

    data: {
      title: data.title,

      description: data.description,

      amount: Number(data.amount),

      expenseType: data.expenseType,

      paymentSource: data.paymentSource,

      paidByUserId:
        data.paymentSource === "EMPLOYEE_PAID"
          ? Number(data.paidByUserId)
          : null,

      expenseDate: new Date(data.expenseDate),
    },
  });
};

export const deleteExpenseService = async (id: number) => {
  return prisma.shopExpense.delete({
    where: {
      id,
    },
  });
};

export const getInventoryAdjustmentsService = async (branchId: number) => {
  return prisma.inventoryAdjustment.findMany({
    where: {
      branchId,
    },

    include: {
      ingredient: {
        select: {
          id: true,
          name: true,
        },
      },

      updatedBy: {
        select: {
          id: true,
          name: true,
        },
      },
    },

    orderBy: {
      createdAt: "desc",
    },
  });
};
export const getInventoryIngredientsService = async (restaurantId: number) => {
  return prisma.ingredient.findMany({
    where: {
      restaurantId,
    },

    select: {
      id: true,
      name: true,
      unit: true,
      quantity: true,
      reorderLevel: true,
    },

    orderBy: {
      name: "asc",
    },
  });
};
export const getInventoryUsersService = async (branchId: number) => {
  return prisma.user.findMany({
    where: {
      branchId,
      isDeleted: false,
    },

    select: {
      id: true,
      name: true,
    },

    orderBy: {
      name: "asc",
    },
  });
};
export const createInventoryAdjustmentService = async (data: any) => {
  return prisma.inventoryAdjustment.create({
    data: {
      restaurantId: data.restaurantId,

      branchId: data.branchId,

      ingredientId: Number(data.ingredientId),

      quantity: Number(data.quantity),

      adjustmentType: data.adjustmentType,

      reason: data.reason,

      updatedById: data.updatedById,
    },
  });
};
export const updateInventoryAdjustmentService = async (
  id: number,
  data: any,
) => {
  return prisma.inventoryAdjustment.update({
    where: {
      id,
    },

    data: {
      ingredientId: Number(data.ingredientId),

      quantity: Number(data.quantity),

      adjustmentType: data.adjustmentType,

      reason: data.reason,

      updatedById: data.updatedById,
    },
  });
};
export const deleteInventoryAdjustmentService = async (id: number) => {
  return prisma.inventoryAdjustment.delete({
    where: {
      id,
    },
  });
};
