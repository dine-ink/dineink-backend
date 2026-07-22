import { Router } from "express";
import {
  getTodayAttendance,
  loginAttendance,
  logoutAttendance,
  createExpense,
  deleteExpense,
  getExpenses,
  getExpenseUsers,
  updateExpense,
  getInventoryAdjustments,
  getInventoryIngredients,
  getInventoryUsers,
  createInventoryAdjustment,
  updateInventoryAdjustment,
  deleteInventoryAdjustment,
} from "./admin.controller";

const router = Router();

router.get("/attendance/:branchId", getTodayAttendance);

router.post("/attendance/login", loginAttendance);

router.post("/attendance/logout", logoutAttendance);

router.get("/expenses/:branchId", getExpenses);

router.get("/expenses/users/:branchId", getExpenseUsers);

router.post("/expenses", createExpense);

router.put("/expenses/:id", updateExpense);

router.delete("/expenses/:id", deleteExpense);
router.get("/inventory/:branchId", getInventoryAdjustments);

router.get("/inventory/ingredients/:restaurantId", getInventoryIngredients);

router.get("/inventory/users/:branchId", getInventoryUsers);

router.post("/inventory", createInventoryAdjustment);

router.put("/inventory/:id", updateInventoryAdjustment);

router.delete("/inventory/:id", deleteInventoryAdjustment);
export default router;
