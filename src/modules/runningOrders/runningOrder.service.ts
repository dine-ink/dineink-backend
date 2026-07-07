import prisma from "../../config/prisma";
import { invalidateDashboardCache } from "../analytics/analytics.service";

// Fix #1 — always create a fresh RunningOrder per order placement.
// Each save = one KOT in kitchen.  No more "find existing and add batch".
export const saveRunningOrderService = async (data: any) => {
  const {
    restaurantId, branchId, createdById, tableId, items, orderType,
    customerName, customerPhone, paymentMethod,
    subtotal, discountAmount, packingCharge, serviceCharge,
    gstAmount, cgst, sgst, finalAmount,
  } = data;

  const isNotDineIn = orderType !== "DINE_IN";
  const batchTotal = items.reduce(
    (sum: number, item: any) => sum + item.quantity * item.price, 0,
  );

  const [runningOrder] = await Promise.all([
    prisma.runningOrder.create({
      data: {
        restaurantId, branchId, createdById, tableId,
        orderType,
        customerName,
        customerPhone,
        paymentMethod,
        status: "ACTIVE",
        kitchenStatus: "PENDING",
        totalAmount: batchTotal,
        paymentStatus: isNotDineIn ? "PAID" : "UNPAID",
        subtotal:        isNotDineIn ? subtotal        : null,
        discountAmount:  isNotDineIn ? discountAmount  : null,
        packingCharge:   isNotDineIn ? packingCharge   : null,
        serviceCharge:   isNotDineIn ? serviceCharge   : null,
        gstAmount:       isNotDineIn ? gstAmount       : null,
        cgst:            isNotDineIn ? cgst            : null,
        sgst:            isNotDineIn ? sgst            : null,
        finalAmount:     isNotDineIn ? finalAmount     : null,
      },
    }),
    // Mark table OCCUPIED on first dine-in order
    orderType === "DINE_IN" && tableId
      ? prisma.restaurantTable.updateMany({
          where: { id: tableId, restaurantId, branchId },
          data: { status: "OCCUPIED" },
        })
      : Promise.resolve(null),
  ]);

  // Create the batch with items
  await prisma.runningOrderBatch.create({
    data: {
      runningOrderId: runningOrder.id,
      items: {
        create: items.map((item: any) => ({
          menuItemId: item.menuItemId,
          itemName:   item.itemName,
          quantity:   item.quantity,
          price:      item.price,
          total:      item.quantity * item.price,
        })),
      },
    },
  });

  return prisma.runningOrder.findUnique({
    where: { id: runningOrder.id },
    include: {
      batches: { include: { items: true }, orderBy: { createdAt: "desc" } },
      table: true,
    },
  });
};

// Fix #3 — return ALL active orders for a table (array, not single record)
export const getRunningOrderByTableService = async (tableId: number) => {
  return prisma.runningOrder.findMany({
    where: { tableId, status: "ACTIVE" },
    include: {
      batches: { include: { items: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });
};

export const getAllRunningOrdersService = async (
  restaurantId: number,
  branchId: number,
) => {
  // Include ACTIVE orders (dine-in) + CLOSED orders whose kitchen hasn't
  // fulfilled yet (quick-takeaway: billed immediately but still needs preparing).
  const orders = await prisma.runningOrder.findMany({
    where: {
      restaurantId,
      branchId,
      OR: [
        { status: "ACTIVE" },
        { status: "CLOSED", kitchenStatus: { in: ["PENDING", "PREPARING"] } },
      ],
    },
    include: {
      batches: { include: { items: true }, orderBy: { createdAt: "asc" } },
      table: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return orders.map((order) => ({
    ...order,
    status: order.kitchenStatus,
    tableName: order.table?.name ?? null,
  }));
};

// ── Item-level cancel request flow ──────────────────────────────────────────

export const requestItemCancelService = async (itemId: number) => {
  return prisma.runningOrderBatchItem.update({
    where: { id: itemId },
    data: { status: "CANCEL_REQUESTED" },
  });
};

export const approveItemCancelService = async (itemId: number) => {
  const item = await prisma.runningOrderBatchItem.findUnique({
    where: { id: itemId },
  });
  if (!item) throw new Error("Item not found");

  const batch = await prisma.runningOrderBatch.findUnique({
    where: { id: item.runningOrderBatchId },
  });
  if (!batch) throw new Error("Batch not found");

  await prisma.$transaction([
    prisma.runningOrderBatchItem.update({
      where: { id: itemId },
      data: { status: "CANCELLED" },
    }),
    prisma.runningOrder.update({
      where: { id: batch.runningOrderId },
      data: { totalAmount: { decrement: item.total } },
    }),
  ]);
};

export const rejectItemCancelService = async (itemId: number) => {
  return prisma.runningOrderBatchItem.update({
    where: { id: itemId },
    data: { status: "PENDING" },
  });
};

export const updateRunningOrderStatusService = async (
  orderId: number,
  status: string,
) => {
  return prisma.runningOrder.update({
    where: { id: orderId },
    data: {
      kitchenStatus: status,
      // Record when kitchen marks the order done so the billing view can show it
      ...(status === "READY" && { completedAt: new Date() }),
    },
  });
};

export const holdRunningOrderService = async (orderId: number) => {
  const order = await prisma.runningOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new Error("Running order not found");
  if (order.status !== "ACTIVE") throw new Error("Only ACTIVE orders can be held");
  return prisma.runningOrder.update({ where: { id: orderId }, data: { status: "HELD" } });
};

export const resumeRunningOrderService = async (orderId: number) => {
  const order = await prisma.runningOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new Error("Running order not found");
  if (order.status !== "HELD") throw new Error("Only HELD orders can be resumed");
  return prisma.runningOrder.update({ where: { id: orderId }, data: { status: "ACTIVE" } });
};

export const discardRunningOrderService = async (orderId: number) => {
  const order = await prisma.runningOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new Error("Running order not found");

  await prisma.$transaction(async (tx) => {
    // Cascade deletes batches + items via onDelete: Cascade on the schema
    await tx.runningOrder.delete({ where: { id: orderId } });

    // Free table only if no other ACTIVE/HELD orders remain on it
    if (order.tableId) {
      const remaining = await tx.runningOrder.count({
        where: { tableId: order.tableId, status: { in: ["ACTIVE", "HELD"] } },
      });
      if (remaining === 0) {
        await tx.restaurantTable.updateMany({
          where: { id: order.tableId },
          data: { status: "AVAILABLE" },
        });
      }
    }
  });

  return { success: true };
};

// Fix #5 — accept tableId to close ALL active orders for a table at once,
// or a single runningOrderId for backwards-compat (quick billing).
export const closeRunningOrderService = async (data: any) => {
  const {
    runningOrderId, tableId,
    customerName, customerPhone, paymentMethod, orderType, orderStatus,
    subtotal, discountAmount, packingCharge, serviceCharge,
    gstAmount, cgst, sgst, finalAmount,
  } = data;

  // Resolve which orders to close
  let runningOrders: any[];
  if (tableId) {
    runningOrders = await prisma.runningOrder.findMany({
      where: { tableId, status: "ACTIVE" },
      include: { batches: { include: { items: true } } },
    });
  } else {
    const single = await prisma.runningOrder.findUnique({
      where: { id: runningOrderId },
      include: { batches: { include: { items: true } } },
    });
    runningOrders = single ? [single] : [];
  }

  if (!runningOrders.length) throw new Error("Running order not found");

  const primary = runningOrders[0];
  const allItems = runningOrders.flatMap((o) =>
    o.batches.flatMap((b: any) => b.items),
  ).filter((item: any) => item.status !== "CANCELLED");
  const computedTotal = runningOrders.reduce(
    (sum, o) => sum + (o.totalAmount ?? 0), 0,
  );

  const bill = await prisma.$transaction(async (tx) => {
    // Upsert customer and free the table inside the transaction so these
    // changes are rolled back automatically if bill creation fails.
    const customer = customerPhone
      ? await tx.customer.upsert({
          where: { phone: customerPhone },
          update: {},
          create: {
            name: customerName || "",
            phone: customerPhone,
            restaurant: { connect: { id: primary.restaurantId } },
          },
        })
      : null;

    if (tableId) {
      await tx.restaurantTable.updateMany({
        where: {
          id: tableId,
          restaurantId: primary.restaurantId,
          branchId: primary.branchId,
        },
        data: { status: "AVAILABLE" },
      });
    } else if (primary.tableId) {
      await tx.restaurantTable.updateMany({
        where: {
          id: primary.tableId,
          restaurantId: primary.restaurantId,
          branchId: primary.branchId,
        },
        data: { status: "AVAILABLE" },
      });
    }

    const created = await tx.bill.create({
      data: {
        billNo: `BILL-${Date.now()}`,
        restaurantId: primary.restaurantId,
        branchId:     primary.branchId,
        customerId:   customer?.id ?? null,
        status:       paymentMethod ? "PAID" : "UNPAID",
        subtotal:     subtotal      ?? computedTotal,
        gst:          gstAmount     ?? 0,
        cgst:         cgst          ?? 0,
        sgst:         sgst          ?? 0,
        discount:     discountAmount ?? 0,
        serviceCharge: serviceCharge ?? 0,
        packingCharge: packingCharge ?? 0,
        total:        finalAmount   ?? computedTotal,
        paymentMethod,
        orderType:    orderType     ?? primary.orderType,
        orderStatus:  orderStatus   ?? "COMPLETED",
        createdById:  primary.createdById,
        items: {
          create: allItems.map((item: any) => ({
            menuItemId: item.menuItemId,
            itemName:   item.itemName,
            quantity:   item.quantity,
            price:      item.price,
            total:      item.total,
          })),
        },
      },
      include: { customer: true, items: true },
    });

    // Mark all resolved running orders as CLOSED (preserves history)
    await tx.runningOrder.updateMany({
      where: { id: { in: runningOrders.map((o) => o.id) } },
      data: { status: "CLOSED" },
    });

    // ── Auto-deduct ingredients based on MenuItemIngredient mappings ──────────
    const menuItemIds = allItems
      .filter((item: any) => item.menuItemId)
      .map((item: any) => item.menuItemId as number);

    if (menuItemIds.length > 0) {
      const mappings = await tx.menuItemIngredient.findMany({
        where: { menuItemId: { in: menuItemIds } },
      });

      if (mappings.length > 0) {
        // Sum quantity sold per menuItem
        const soldQtyMap = new Map<number, number>();
        for (const item of allItems as any[]) {
          if (item.menuItemId) {
            soldQtyMap.set(item.menuItemId, (soldQtyMap.get(item.menuItemId) ?? 0) + item.quantity);
          }
        }

        // Accumulate total deduction per ingredient
        const ingredientDeductions = new Map<number, number>();
        for (const mapping of mappings) {
          const soldQty = soldQtyMap.get(mapping.menuItemId) ?? 0;
          const deductQty = mapping.quantity * soldQty;
          ingredientDeductions.set(
            mapping.ingredientId,
            (ingredientDeductions.get(mapping.ingredientId) ?? 0) + deductQty,
          );
        }

        await Promise.all([
          // Decrement ingredient stock
          ...Array.from(ingredientDeductions.entries()).map(([ingredientId, qty]) =>
            tx.ingredient.update({
              where: { id: ingredientId },
              data: { quantity: { decrement: qty } },
            }),
          ),
          // Log adjustment records
          tx.inventoryAdjustment.createMany({
            data: Array.from(ingredientDeductions.entries()).map(([ingredientId, qty]) => ({
              restaurantId: primary.restaurantId,
              branchId:     primary.branchId,
              ingredientId,
              quantity:     qty,
              adjustmentType: "SALE_DEDUCTION",
              reason:       `Auto-deducted: bill ${created.billNo}`,
              updatedById:  primary.createdById ?? null,
            })),
          }),
        ]);
      }
    }

    return created;
  });

  invalidateDashboardCache(primary.restaurantId);
  return bill;
};
