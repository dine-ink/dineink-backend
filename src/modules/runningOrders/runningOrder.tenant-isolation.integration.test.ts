// Integration test — hits the real configured database directly. Creates
// its own isolated fixture restaurants and deletes every row afterward.
//
// Verifies the CRITICAL release-hardening security fix: every runningOrder.
// service.ts mutation (save, item cancel/approve/reject, toggle-done,
// status update, hold/resume/discard, close) must reject a caller trying to
// act on another restaurant's data, and must still succeed for a caller
// acting on their own.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "../../config/prisma";
import {
  approveItemCancelService,
  closeRunningOrderService,
  discardRunningOrderService,
  getRunningOrderByTableService,
  holdRunningOrderService,
  rejectItemCancelService,
  requestItemCancelService,
  resumeRunningOrderService,
  saveRunningOrderService,
  toggleItemDoneService,
  updateRunningOrderStatusService,
} from "./runningOrder.service";
import { ForbiddenError } from "./runningOrder.validation";

describe("RunningOrders module tenant isolation — integration (real database)", () => {
  let restaurantAId: number;
  let restaurantBId: number;
  let branchAId: number;
  let branchBId: number;
  let tableAId: number;
  let tableBId: number;
  // A second Restaurant B table, used only by the destructive tests
  // (discard/close) so they never collide with orderBId's lifecycle on
  // tableBId, which the hold/resume test leaves back in ACTIVE status.
  let tableBScratchId: number;
  let orderBId: number;
  let itemBId: number;

  // Creates a fresh ACTIVE running order (with one batch item) on the given
  // table, bypassing saveRunningOrderService so each test gets an isolated
  // fixture regardless of what saveRunningOrderService itself is being
  // tested for.
  const createTestOrder = async (restaurantId: number, branchId: number, tableId: number) => {
    const order = await prisma.runningOrder.create({
      data: { restaurantId, branchId, tableId, orderType: "DINE_IN", totalAmount: 100 },
    });
    const batch = await prisma.runningOrderBatch.create({ data: { runningOrderId: order.id } });
    const item = await prisma.runningOrderBatchItem.create({
      data: { runningOrderBatchId: batch.id, itemName: "Test Item", quantity: 1, price: 100, total: 100 },
    });
    return { order, batch, item };
  };

  beforeAll(async () => {
    const [a, b] = await Promise.all([
      prisma.restaurant.create({ data: { name: "Vitest RunningOrder Tenant Isolation Restaurant A" } }),
      prisma.restaurant.create({ data: { name: "Vitest RunningOrder Tenant Isolation Restaurant B" } }),
    ]);
    restaurantAId = a.id;
    restaurantBId = b.id;
    const [branchA, branchB] = await Promise.all([
      prisma.branch.create({ data: { restaurantId: restaurantAId, name: "Branch A" } }),
      prisma.branch.create({ data: { restaurantId: restaurantBId, name: "Branch B" } }),
    ]);
    branchAId = branchA.id;
    branchBId = branchB.id;
    const [tableA, tableB, tableBScratch] = await Promise.all([
      prisma.restaurantTable.create({ data: { restaurantId: restaurantAId, branchId: branchAId, name: "Table A" } }),
      prisma.restaurantTable.create({ data: { restaurantId: restaurantBId, branchId: branchBId, name: "Table B" } }),
      prisma.restaurantTable.create({ data: { restaurantId: restaurantBId, branchId: branchBId, name: "Table B Scratch" } }),
    ]);
    tableAId = tableA.id;
    tableBId = tableB.id;
    tableBScratchId = tableBScratch.id;

    const { order, item } = await createTestOrder(restaurantBId, branchBId, tableBId);
    orderBId = order.id;
    itemBId = item.id;
  });

  afterAll(async () => {
    await prisma.runningOrder.deleteMany({ where: { restaurantId: { in: [restaurantAId, restaurantBId] } } });
    // closeRunningOrderService creates real Bill rows — must clear those
    // before the restaurant can be deleted (Bill_restaurantId_fkey RESTRICT).
    await prisma.billItem.deleteMany({ where: { bill: { restaurantId: { in: [restaurantAId, restaurantBId] } } } });
    await prisma.bill.deleteMany({ where: { restaurantId: { in: [restaurantAId, restaurantBId] } } });
    await prisma.restaurantTable.deleteMany({ where: { restaurantId: { in: [restaurantAId, restaurantBId] } } });
    await prisma.branch.deleteMany({ where: { restaurantId: { in: [restaurantAId, restaurantBId] } } });
    await prisma.restaurant.deleteMany({ where: { id: { in: [restaurantAId, restaurantBId] } } });
  });

  it("saveRunningOrderService rejects a branchId belonging to a different restaurant", async () => {
    await expect(
      saveRunningOrderService(restaurantAId, { branchId: branchBId, orderType: "DINE_IN", items: [{ itemName: "x", quantity: 1, price: 10 }] }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("saveRunningOrderService rejects a tableId belonging to a different restaurant", async () => {
    await expect(
      saveRunningOrderService(restaurantAId, { branchId: branchAId, tableId: tableBId, orderType: "DINE_IN", items: [{ itemName: "x", quantity: 1, price: 10 }] }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("saveRunningOrderService always uses the caller's own restaurantId for a valid same-tenant branch/table", async () => {
    const order = await saveRunningOrderService(restaurantAId, {
      branchId: branchAId,
      tableId: tableAId,
      orderType: "DINE_IN",
      items: [{ itemName: "Valid Item", quantity: 1, price: 50 }],
    });
    expect(order!.restaurantId).toBe(restaurantAId);
    await prisma.runningOrder.delete({ where: { id: order!.id } });
  });

  it("getRunningOrderByTableService never returns another restaurant's orders", async () => {
    const asAttacker = await getRunningOrderByTableService(restaurantAId, tableBId);
    expect(asAttacker).toHaveLength(0);
    const asOwner = await getRunningOrderByTableService(restaurantBId, tableBId);
    expect(asOwner.map((o) => o.id)).toContain(orderBId);
  });

  it("requestItemCancelService/approveItemCancelService/rejectItemCancelService reject Restaurant A acting on Restaurant B's item", async () => {
    await expect(requestItemCancelService(restaurantAId, itemBId)).rejects.toThrow(ForbiddenError);
    await expect(approveItemCancelService(restaurantAId, itemBId)).rejects.toThrow(ForbiddenError);
    await expect(rejectItemCancelService(restaurantAId, itemBId)).rejects.toThrow(ForbiddenError);

    // Restaurant B can still manage its own item.
    const requested = await requestItemCancelService(restaurantBId, itemBId);
    expect(requested.status).toBe("CANCEL_REQUESTED");
    const rejected = await rejectItemCancelService(restaurantBId, itemBId);
    expect(rejected.status).toBe("PENDING");
  });

  it("toggleItemDoneService rejects Restaurant A acting on Restaurant B's item", async () => {
    await expect(toggleItemDoneService(restaurantAId, itemBId, true)).rejects.toThrow(ForbiddenError);
    const done = await toggleItemDoneService(restaurantBId, itemBId, true);
    expect(done.status).toBe("DONE");
    await toggleItemDoneService(restaurantBId, itemBId, false);
  });

  it("updateRunningOrderStatusService rejects Restaurant A acting on Restaurant B's order", async () => {
    await expect(updateRunningOrderStatusService(restaurantAId, orderBId, "PREPARING")).rejects.toThrow(ForbiddenError);
    const updated = await updateRunningOrderStatusService(restaurantBId, orderBId, "PREPARING");
    expect(updated.kitchenStatus).toBe("PREPARING");
  });

  it("holdRunningOrderService/resumeRunningOrderService reject Restaurant A acting on Restaurant B's order", async () => {
    await expect(holdRunningOrderService(restaurantAId, orderBId)).rejects.toThrow(ForbiddenError);
    const held = await holdRunningOrderService(restaurantBId, orderBId);
    expect(held.status).toBe("HELD");

    await expect(resumeRunningOrderService(restaurantAId, orderBId)).rejects.toThrow(ForbiddenError);
    const resumed = await resumeRunningOrderService(restaurantBId, orderBId);
    expect(resumed.status).toBe("ACTIVE");
  });

  it("discardRunningOrderService rejects Restaurant A acting on Restaurant B's order", async () => {
    const { order } = await createTestOrder(restaurantBId, branchBId, tableBScratchId);
    await expect(discardRunningOrderService(restaurantAId, order.id)).rejects.toThrow(ForbiddenError);
    const result = await discardRunningOrderService(restaurantBId, order.id);
    expect(result.success).toBe(true);
  });

  it("closeRunningOrderService rejects Restaurant A closing (billing) Restaurant B's order by id", async () => {
    const { order } = await createTestOrder(restaurantBId, branchBId, tableBScratchId);
    await expect(
      closeRunningOrderService(restaurantAId, { runningOrderId: order.id }),
    ).rejects.toThrow(ForbiddenError);
    // Restaurant B can still close (bill) its own order.
    const bill = await closeRunningOrderService(restaurantBId, { runningOrderId: order.id, paymentMethod: "CASH" });
    expect(bill.restaurantId).toBe(restaurantBId);
  });

  it("closeRunningOrderService rejects Restaurant A closing (billing) Restaurant B's table by tableId", async () => {
    await createTestOrder(restaurantBId, branchBId, tableBScratchId);
    await expect(
      closeRunningOrderService(restaurantAId, { tableId: tableBScratchId }),
    ).rejects.toThrow(ForbiddenError);
    const bill = await closeRunningOrderService(restaurantBId, { tableId: tableBScratchId, paymentMethod: "CASH" });
    expect(bill.restaurantId).toBe(restaurantBId);
  });
});
