import { Request, Response } from "express";

import {
  getTodayAttendanceService,
  loginAttendanceService,
  logoutAttendanceService,
  startBreakService,
  endBreakService,
} from "./admin.service";

export const getTodayAttendance = async (req: Request, res: Response) => {
  try {
    const branchId = Number(req.params.branchId);

    const data = await getTodayAttendanceService(branchId);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.log(error);

    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const loginAttendance = async (req: Request, res: Response) => {
  try {
    const data = await loginAttendanceService(req.body);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.log(error);

    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const logoutAttendance = async (req: Request, res: Response) => {
  try {
    const attendanceId = Number(req.body.attendanceId);

    const data = await logoutAttendanceService(attendanceId);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.log(error);

    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const startBreak = async (req: Request, res: Response) => {
  try {
    const attendanceId = Number(req.body.attendanceId);

    const data = await startBreakService(attendanceId);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.log(error);

    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const endBreak = async (req: Request, res: Response) => {
  try {
    const attendanceId = Number(req.body.attendanceId);

    const data = await endBreakService(attendanceId);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.log(error);

    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
