import { Router } from "express";
import {
  getTodayAttendance,
  loginAttendance,
  logoutAttendance,
  startBreak,
  endBreak,
  createExpense,
  deleteExpense,
  getExpenses,
  getExpenseUsers,
  updateExpense,
} from "./admin.controller";

const router = Router();

router.get("/attendance/:branchId", getTodayAttendance);

router.post("/attendance/login", loginAttendance);

router.post("/attendance/logout", logoutAttendance);

router.post("/attendance/start-break", startBreak);

router.post("/attendance/end-break", endBreak);
router.get("/expenses/:branchId", getExpenses);

router.get("/expenses/users/:branchId", getExpenseUsers);

router.post("/expenses", createExpense);

router.put("/expenses/:id", updateExpense);

router.delete("/expenses/:id", deleteExpense);
export default router;
