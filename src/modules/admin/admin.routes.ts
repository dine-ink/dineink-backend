import { Router } from "express";
import {
  getTodayAttendance,
  loginAttendance,
  logoutAttendance,
  startBreak,
  endBreak,
} from "./admin.controller";

const router = Router();

router.get("/attendance/:branchId", getTodayAttendance);

router.post("/attendance/login", loginAttendance);

router.post("/attendance/logout", logoutAttendance);

router.post("/attendance/start-break", startBreak);

router.post("/attendance/end-break", endBreak);

export default router;
