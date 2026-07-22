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
import { authMiddleware } from "../../middleware/auth";
import { requireOwnBranch, requireOwnRestaurant } from "../../middleware/authorize";

const router = Router();

// This entire module had no authMiddleware at all — every route below was
// reachable by anyone, unauthenticated, for any restaurant/branch.
router.get("/attendance/:branchId", authMiddleware, requireOwnBranch(), getTodayAttendance);

router.post("/attendance/login", authMiddleware, loginAttendance);

router.post("/attendance/logout", authMiddleware, logoutAttendance);

router.get("/expenses/:branchId", authMiddleware, requireOwnBranch(), getExpenses);

router.get("/expenses/users/:branchId", authMiddleware, requireOwnBranch(), getExpenseUsers);

router.post("/expenses", authMiddleware, createExpense);

router.put("/expenses/:id", authMiddleware, updateExpense);

router.delete("/expenses/:id", authMiddleware, deleteExpense);
router.get("/inventory/:branchId", authMiddleware, requireOwnBranch(), getInventoryAdjustments);

router.get("/inventory/ingredients/:restaurantId", authMiddleware, requireOwnRestaurant(), getInventoryIngredients);

router.get("/inventory/users/:branchId", authMiddleware, requireOwnBranch(), getInventoryUsers);

router.post("/inventory", authMiddleware, createInventoryAdjustment);

router.put("/inventory/:id", authMiddleware, updateInventoryAdjustment);

router.delete("/inventory/:id", authMiddleware, deleteInventoryAdjustment);
export default router;
