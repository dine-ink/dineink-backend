import { Request, Response } from "express";
import {
  getLeaveRequestsService,
  createLeaveRequestService,
  updateLeaveRequestStatusService,
  deleteLeaveRequestService,
} from "./leave.service";
import { ForbiddenError } from "./attendance.validation";

const handleError = (error: any, res: Response) => {
  if (error instanceof ForbiddenError) {
    return res.status(403).json({ success: false, message: error.message });
  }
  return res.status(400).json({ success: false, message: error.message });
};

export const getLeaveRequests = async (req: Request, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const status = req.query.status as string | undefined;
    const data = await getLeaveRequestsService(restaurantId, branchId, status);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const createLeaveRequest = async (req: any, res: Response) => {
  try {
    const { userId, branchId, leaveType, startDate, endDate, reason } = req.body;
    const data = await createLeaveRequestService(Number(req.user.restaurantId), {
      userId: Number(userId),
      branchId: Number(branchId),
      leaveType,
      startDate,
      endDate,
      reason,
    });
    return res.status(201).json({ success: true, data });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const updateLeaveRequestStatus = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;
    if (status !== "APPROVED" && status !== "REJECTED") {
      return res.status(400).json({ success: false, message: "status must be APPROVED or REJECTED" });
    }
    const data = await updateLeaveRequestStatusService(
      Number(req.user.restaurantId),
      id,
      status,
      req.user?.id ? Number(req.user.id) : undefined,
    );
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return handleError(error, res);
  }
};

export const deleteLeaveRequest = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    await deleteLeaveRequestService(Number(req.user.restaurantId), id);
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return handleError(error, res);
  }
};
