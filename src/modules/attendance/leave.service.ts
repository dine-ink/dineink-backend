import prisma from "../../config/prisma";
import { ForbiddenError } from "./attendance.validation";

// Leave requests (CASUAL | SICK | EARNED | UNPAID). Ownership is enforced the
// same way attendance.service.ts's upsertManualAttendanceService does: verify
// the target user belongs to the caller's own restaurant before writing, and
// for existing rows, fetch-then-compare restaurantId.
//
// TWO CALLERS, TWO SHAPES. Most staff have no login of their own
// (User.hasLogin defaults false), so in practice an employee tells the manager
// and the manager records an already-settled decision from the POS — one
// write, not a request awaiting approval. `status` on create exists for that
// caller: passing "APPROVED" lands a finished row directly instead of forcing
// a create-then-PATCH pair, where a failure between the two calls would leave
// the leave stuck PENDING with nobody watching a queue. Omitting it keeps the
// original PENDING default for any caller that does want the approval loop.

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
    /** See this module's header comment. Defaults to PENDING when omitted. */
    status?: "PENDING" | "APPROVED" | "REJECTED";
    /** Recorded as the approver when `status` is APPROVED — the manager who entered it. */
    decidedById?: number;
  },
) => {
  const user = await prisma.user.findUnique({
    where: { id: data.userId },
    select: { restaurantId: true },
  });
  if (!user || user.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this employee");
  }

  const status = data.status || "PENDING";

  return prisma.leaveRequest.create({
    data: {
      userId: data.userId,
      restaurantId: callerRestaurantId,
      branchId: data.branchId,
      leaveType: data.leaveType || "CASUAL",
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      reason: data.reason,
      status,
      // Only stamped for an already-settled row — a PENDING request has no
      // approver yet, and writing one would misreport who decided it.
      ...(status === "APPROVED" && data.decidedById !== undefined
        ? { approvedById: data.decidedById }
        : {}),
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
