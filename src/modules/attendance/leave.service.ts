import prisma from "../../config/prisma";
import { ForbiddenError } from "./attendance.validation";

// Leave requests (CASUAL | SICK | EARNED | UNPAID). Staff submit their own
// request (PENDING); OWNER/MANAGER approve/reject/delete. Ownership is
// enforced the same way attendance.service.ts's upsertManualAttendanceService
// does: verify the target user belongs to the caller's own restaurant before
// writing, and for existing rows, fetch-then-compare restaurantId.

export const getLeaveRequestsService = async (
  restaurantId: number,
  branchId: number,
  status?: string,
) => {
  return prisma.leaveRequest.findMany({
    where: {
      restaurantId,
      branchId,
      ...(status ? { status } : {}),
    },
    include: {
      user: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
};

export const createLeaveRequestService = async (
  callerRestaurantId: number,
  data: {
    userId: number;
    branchId: number;
    leaveType?: string;
    startDate: string;
    endDate: string;
    reason?: string;
  },
) => {
  const user = await prisma.user.findUnique({
    where: { id: data.userId },
    select: { restaurantId: true },
  });
  if (!user || user.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this employee");
  }

  return prisma.leaveRequest.create({
    data: {
      userId: data.userId,
      restaurantId: callerRestaurantId,
      branchId: data.branchId,
      leaveType: data.leaveType || "CASUAL",
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      reason: data.reason,
      status: "PENDING",
    },
  });
};

export const updateLeaveRequestStatusService = async (
  callerRestaurantId: number,
  id: number,
  status: "APPROVED" | "REJECTED",
  approvedById?: number,
) => {
  const existing = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!existing || existing.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this leave request");
  }

  return prisma.leaveRequest.update({
    where: { id },
    data: {
      status,
      ...(approvedById !== undefined ? { approvedById } : {}),
    },
  });
};

export const deleteLeaveRequestService = async (
  callerRestaurantId: number,
  id: number,
) => {
  const existing = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!existing || existing.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this leave request");
  }

  return prisma.leaveRequest.delete({ where: { id } });
};
