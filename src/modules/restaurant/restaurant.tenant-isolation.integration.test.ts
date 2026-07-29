// Integration test — hits the real configured database directly. Creates
// its own isolated fixture restaurants and deletes every row afterward.
//
// Verifies the CRITICAL release-hardening security fix: every restaurant.
// service.ts mutation (table/staff/category/menu item create/update/delete)
// must reject a caller trying to act on another restaurant's data, and must
// still succeed for a caller acting on their own.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "../../config/prisma";
import {
  createCategoryService,
  createMenuItemService,
  createRestaurantTableService,
  createStaffService,
  deleteCategoryService,
  deleteMenuItemService,
  deleteRestaurantTableService,
  updateCategoryService,
  updateMenuItemService,
  updateStaffService,
} from "./restaurant.service";
import { ForbiddenError } from "./restaurant.validation";

describe("Restaurant module tenant isolation — integration (real database)", () => {
  let restaurantAId: number;
  let restaurantBId: number;
  let branchAId: number;
  let branchBId: number;
  let categoryAId: number;
  let categoryBId: number;
  let menuItemAId: number;
  let menuItemBId: number;
  let staffAId: number;
  let tableAId: number;

  beforeAll(async () => {
    const [a, b] = await Promise.all([
      prisma.restaurant.create({ data: { name: "Vitest Tenant Isolation Restaurant A" } }),
      prisma.restaurant.create({ data: { name: "Vitest Tenant Isolation Restaurant B" } }),
    ]);
    restaurantAId = a.id;
    restaurantBId = b.id;
    const [branchA, branchB] = await Promise.all([
      prisma.branch.create({ data: { restaurantId: restaurantAId, name: "Branch A" } }),
      prisma.branch.create({ data: { restaurantId: restaurantBId, name: "Branch B" } }),
    ]);
    branchAId = branchA.id;
    branchBId = branchB.id;

    const [categoryA, categoryB] = await Promise.all([
      createCategoryService(restaurantAId, { name: "Cat A" }),
      createCategoryService(restaurantBId, { name: "Cat B" }),
    ]);
    categoryAId = categoryA.id;
    categoryBId = categoryB.id;

    const [menuItemA, menuItemB] = await Promise.all([
      createMenuItemService(restaurantAId, { name: "Item A", price: 100 }),
      createMenuItemService(restaurantBId, { name: "Item B", price: 100 }),
    ]);
    menuItemAId = menuItemA.id;
    menuItemBId = menuItemB.id;

    const staffA = await createStaffService(restaurantAId, { name: "Staff A", password: "password123" });
    staffAId = staffA.id;

    const tableA = await createRestaurantTableService(restaurantAId, { name: "Table A", branchId: branchAId, capacity: 4 });
    tableAId = tableA.id;
  });

  afterAll(async () => {
    await prisma.menuItem.deleteMany({ where: { restaurantId: { in: [restaurantAId, restaurantBId] } } });
    await prisma.category.deleteMany({ where: { restaurantId: { in: [restaurantAId, restaurantBId] } } });
    await prisma.restaurantTable.deleteMany({ where: { restaurantId: { in: [restaurantAId, restaurantBId] } } });
    await prisma.user.deleteMany({ where: { restaurantId: { in: [restaurantAId, restaurantBId] } } });
    await prisma.branch.deleteMany({ where: { restaurantId: { in: [restaurantAId, restaurantBId] } } });
    await prisma.restaurant.deleteMany({ where: { id: { in: [restaurantAId, restaurantBId] } } });
  });

  it("createRestaurantTableService rejects a branchId belonging to a different restaurant", async () => {
    await expect(
      createRestaurantTableService(restaurantAId, { name: "Sneaky Table", branchId: branchBId, capacity: 2 }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("createMenuItemService always uses the caller's own restaurantId, ignoring any client-supplied value", async () => {
    const item = await createMenuItemService(restaurantAId, { name: "Forced Item", price: 50, restaurantId: restaurantBId });
    expect(item.restaurantId).toBe(restaurantAId);
    await prisma.menuItem.delete({ where: { id: item.id } });
  });

  it("updateCategoryService/deleteCategoryService reject Restaurant A acting on Restaurant B's category", async () => {
    await expect(updateCategoryService(restaurantAId, categoryBId, { name: "Hacked" })).rejects.toThrow(ForbiddenError);
    await expect(deleteCategoryService(restaurantAId, categoryBId)).rejects.toThrow(ForbiddenError);
    // Restaurant A can still manage its own category.
    const updated = await updateCategoryService(restaurantAId, categoryAId, { name: "Cat A Renamed" });
    expect(updated.name).toBe("Cat A Renamed");
  });

  it("updateMenuItemService/deleteMenuItemService reject Restaurant A acting on Restaurant B's menu item", async () => {
    await expect(updateMenuItemService(restaurantAId, menuItemBId, { name: "Hacked Item" })).rejects.toThrow(ForbiddenError);
    await expect(deleteMenuItemService(restaurantAId, menuItemBId)).rejects.toThrow(ForbiddenError);
    const updated = await updateMenuItemService(restaurantAId, menuItemAId, { name: "Item A Renamed" });
    expect(updated.name).toBe("Item A Renamed");
  });

  it("deleteRestaurantTableService rejects Restaurant B acting on Restaurant A's table", async () => {
    await expect(deleteRestaurantTableService(restaurantBId, tableAId)).rejects.toThrow(ForbiddenError);
  });

  it("updateStaffService rejects Restaurant B acting on Restaurant A's staff member", async () => {
    await expect(updateStaffService(restaurantBId, staffAId, { name: "Hacked Staff" })).rejects.toThrow(ForbiddenError);
    const updated = await updateStaffService(restaurantAId, staffAId, { name: "Staff A Renamed" });
    expect(updated.name).toBe("Staff A Renamed");
  });
});
