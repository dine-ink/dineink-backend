// Integration test — hits the real configured database directly. Creates
// its own isolated fixture restaurants and deletes every row afterward.
//
// Verifies the CRITICAL release-hardening security fix: every admin.
// service.ts mutation (expense/inventory-adjustment/attendance create/
// update/delete) must reject a caller trying to act on another
// restaurant's data, and must still succeed for a caller acting on their own.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "../../config/prisma";
import {
  createExpenseService,
  createInventoryAdjustmentService,
  deleteExpenseService,
  deleteInventoryAdjustmentService,
  loginAttendanceService,
  logoutAttendanceService,
  updateExpenseService,
  updateInventoryAdjustmentService,
} from "./admin.service";
import { ForbiddenError } from "./admin.validation";

describe("Admin module tenant isolation — integration (real database)", () => {
  let restaurantAId: number;
  let restaurantBId: number;
  let branchAId: number;
  let branchBId: number;
  let ingredientAId: number;
  let staffAId: number;
  let expenseAId: number;
  let expenseBId: number;
  let adjustmentAId: number;
  let adjustmentBId: number;

  beforeAll(async () => {
    const [a, b] = await Promise.all([
      prisma.restaurant.create({ data: { name: "Vitest Admin Tenant Isolation Restaurant A" } }),
      prisma.restaurant.create({ data: { name: "Vitest Admin Tenant Isolation Restaurant B" } }),
    ]);
    restaurantAId = a.id;
    restaurantBId = b.id;
    const [branchA, branchB] = await Promise.all([
      prisma.branch.create({ data: { restaurantId: restaurantAId, name: "Branch A" } }),
      prisma.branch.create({ data: { restaurantId: restaurantBId, name: "Branch B" } }),
    ]);
    branchAId = branchA.id;
    branchBId = branchB.id;

    const ingredientA = await prisma.ingredient.create({
      data: { restaurantId: restaurantAId, name: "Ingredient A" },
    });
    ingredientAId = ingredientA.id;

    const staffA = await prisma.user.create({
      data: { restaurantId: restaurantAId, branchId: branchAId, name: "Staff A", password: "x", role: "STAFF", hasLogin: false },
    });
    staffAId = staffA.id;

    const [expenseA, expenseB] = await Promise.all([
      createExpenseService(restaurantAId, { branchId: branchAId, title: "Expense A", amount: 100, paymentSource: "SHOP_PAID", expenseDate: new Date().toISOString() }),
      createExpenseService(restaurantBId, { branchId: branchBId, title: "Expense B", amount: 100, paymentSource: "SHOP_PAID", expenseDate: new Date().toISOString() }),
    ]);
    expenseAId = expenseA.id;
    expenseBId = expenseB.id;

    const [adjustmentA, adjustmentB] = await Promise.all([
      createInventoryAdjustmentService(restaurantAId, { branchId: branchAId, ingredientId: ingredientAId, quantity: 1, adjustmentType: "MANUAL" }),
      createInventoryAdjustmentService(restaurantBId, { branchId: branchBId, ingredientId: ingredientAId, quantity: 1, adjustmentType: "MANUAL" }),
    ]);
    adjustmentAId = adjustmentA.id;
    adjustmentBId = adjustmentB.id;
  });

  afterAll(async () => {
    await prisma.inventoryAdjustment.deleteMany({ where: { restaurantId: { in: [restaurantAId, restaurantBId] } } });
    await prisma.shopExpense.deleteMany({ where: { restaurantId: { in: [restaurantAId, restaurantBId] } } });
    await prisma.attendance.deleteMany({ where: { restaurantId: { in: [restaurantAId, restaurantBId] } } });
    await prisma.ingredient.deleteMany({ where: { restaurantId: { in: [restaurantAId, restaurantBId] } } });
    await prisma.user.deleteMany({ where: { restaurantId: { in: [restaurantAId, restaurantBId] } } });
    await prisma.branch.deleteMany({ where: { restaurantId: { in: [restaurantAId, restaurantBId] } } });
    await prisma.restaurant.deleteMany({ where: { id: { in: [restaurantAId, restaurantBId] } } });
  });

  it("createExpenseService rejects a branchId belonging to a different restaurant", async () => {
    await expect(
      createExpenseService(restaurantAId, { branchId: branchBId, title: "Sneaky", amount: 1, paymentSource: "SHOP_PAID", expenseDate: new Date().toISOString() }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("createExpenseService always uses the caller's own restaurantId", async () => {
    const expense = await createExpenseService(restaurantAId, { branchId: branchAId, title: "Forced", amount: 1, paymentSource: "SHOP_PAID", expenseDate: new Date().toISOString() });
    expect(expense.restaurantId).toBe(restaurantAId);
    await prisma.shopExpense.delete({ where: { id: expense.id } });
  });

  it("updateExpenseService/deleteExpenseService reject Restaurant A acting on Restaurant B's expense", async () => {
    const patch = { title: "Hacked", amount: 1, paymentSource: "SHOP_PAID", expenseDate: new Date().toISOString() };
    await expect(updateExpenseService(restaurantAId, expenseBId, patch)).rejects.toThrow(ForbiddenError);
    await expect(deleteExpenseService(restaurantAId, expenseBId)).rejects.toThrow(ForbiddenError);
    const updated = await updateExpenseService(restaurantAId, expenseAId, { ...patch, title: "Expense A Renamed" });
    expect(updated.title).toBe("Expense A Renamed");
  });

  it("createInventoryAdjustmentService rejects a branchId belonging to a different restaurant", async () => {
    await expect(
      createInventoryAdjustmentService(restaurantAId, { branchId: branchBId, ingredientId: ingredientAId, quantity: 1, adjustmentType: "MANUAL" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("updateInventoryAdjustmentService/deleteInventoryAdjustmentService reject Restaurant A acting on Restaurant B's adjustment", async () => {
    const patch = { ingredientId: ingredientAId, quantity: 99, adjustmentType: "MANUAL" };
    await expect(updateInventoryAdjustmentService(restaurantAId, adjustmentBId, patch)).rejects.toThrow(ForbiddenError);
    await expect(deleteInventoryAdjustmentService(restaurantAId, adjustmentBId)).rejects.toThrow(ForbiddenError);
    const updated = await updateInventoryAdjustmentService(restaurantAId, adjustmentAId, { ...patch, quantity: 5 });
    expect(updated.quantity).toBe(5);
  });

  it("loginAttendanceService rejects a userId belonging to a different restaurant", async () => {
    await expect(
      loginAttendanceService(restaurantBId, { userId: staffAId, branchId: branchBId }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("logoutAttendanceService rejects Restaurant B acting on Restaurant A's attendance record", async () => {
    const attendance = await loginAttendanceService(restaurantAId, { userId: staffAId, branchId: branchAId });
    await expect(logoutAttendanceService(restaurantBId, attendance.id)).rejects.toThrow(ForbiddenError);
    const closed = await logoutAttendanceService(restaurantAId, attendance.id);
    expect(closed.logoutTime).not.toBeNull();
  });
});
