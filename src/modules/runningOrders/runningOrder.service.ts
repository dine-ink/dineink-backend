import prisma from "../../config/prisma";
import { invalidateDashboardCache } from "../analytics/analytics.service";
import { generateBillNo } from "../bills/invoiceNumber.service";
import { redeemDiscountCodeInTx } from "../discounts/discount.service";

// Fix #1 — always create a fresh RunningOrder per order placement.
// Each save = one KOT in kitchen.  No more "find existing and add batch".
export const saveRunningOrderService = async (data: any) => {
  const {
    restaurantId, branchId, createdById, tableId, items, orderType,
    customerName, customerPhone, paymentMethod,
    subtotal, discountAmount, packingCharge, serviceCharge,
    gstAmount, cgst, sgst, finalAmount, tipAmount,
  } = data;

  const isNotDineIn = orderType !== "DINE_IN";
  // Add-ons are additive on top of the item's own price (e.g. "+₹40" for
  // extra cheese) — snapshotted name/price per line so a later price change
  // on the AddOn doesn't rewrite an already-placed order.
  const addOnTotal = (item: any) =>
    (item.addOns || []).reduce((s: number, a: any) => s + (Number(a.price) || 0), 0);
  const lineTotal = (item: any) => item.quantity * (item.price + addOnTotal(item));
  const batchTotal = items.reduce(
    (sum: number, item: any) => sum + lineTotal(item), 0,
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
        tipAmount:       isNotDineIn ? tipAmount        : null,
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
          total:      lineTotal(item),
          notes:      item.notes || null,
          addOns: (item.addOns || []).length
            ? {
                create: item.addOns.map((a: any) => ({
                  name: a.name,
                  price: Number(a.price) || 0,
                })),
              }
            : undefined,
        })),
      },
    },
  });

  return prisma.runningOrder.findUnique({
    where: { id: runningOrder.id },
    include: {
      batches: {
        include: { items: { include: { addOns: true } } },
        orderBy: { createdAt: "desc" },
      },
      table: true,
    },
  });
};

// Fix #3 — return ALL active orders for a table (array, not single record)
export const getRunningOrderByTableService = async (tableId: number) => {
  return prisma.runningOrder.findMany({
    where: { tableId, status: "ACTIVE" },
    include: {
      batches: { include: { items: { include: { addOns: true } } }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });
};

export const getAllRunningOrdersService = async (
  restaurantId: number,
  branchId: number,
) => {
  // Include ACTIVE orders (dine-in) + BILLED orders whose kitchen hasn't
  // fulfilled yet (quick-takeaway: billed immediately at checkout, but still
  // needs preparing — see closeRunningOrderService's keepOrderActive).
  const orders = await prisma.runningOrder.findMany({
    where: {
      restaurantId,
      branchId,
      OR: [
        { status: "ACTIVE" },
        { status: "BILLED", kitchenStatus: { in: ["PENDING", "PREPARING"] } },
      ],
    },
    include: {
      batches: { include: { items: { include: { addOns: true } } }, orderBy: { createdAt: "asc" } },
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

// Kitchen-item "done" checkbox used to be tracked purely in each device's
// local component state, so two KDS tablets viewing the same order kept
// independent checklists — one station could mark the whole order Ready
// before another had actually finished its items. Persisting it here on the
// item row itself gives every device the same source of truth.
export const toggleItemDoneService = async (itemId: number, done: boolean) => {
  const item = await prisma.runningOrderBatchItem.findUnique({ where: { id: itemId } });
  if (!item) throw new Error("Item not found");
  if (item.status === "CANCELLED" || item.status === "CANCEL_REQUESTED") {
    throw new Error("Cannot mark a cancelled item done");
  }
  return prisma.runningOrderBatchItem.update({
    where: { id: itemId },
    data: { status: done ? "DONE" : "PENDING" },
  });
};

export const updateRunningOrderStatusService = async (
  orderId: number,
  status: string,
) => {
  // kitchenStatus tracks kitchen prep progress; the billing lifecycle
  // ("ACTIVE" while ordering, "BILLED" once billed upfront but still
  // preparing, "CLOSED" once fully done — see closeRunningOrderService) is a
  // separate concern. Marking the kitchen READY must NOT also close an
  // ACTIVE (not-yet-billed) order, or it vanishes from both the Orders page
  // (getBillsService filters out CLOSED/BILLED) and the notification-bell
  // poll (getAllRunningOrdersService only returns BILLED orders while
  // kitchenStatus is still PENDING/PREPARING) before staff ever get to press
  // "Complete".
  const updated = await prisma.runningOrder.update({
    where: { id: orderId },
    data: {
      kitchenStatus: status,
      ...(status === "READY" && { completedAt: new Date() }),
    },
  });

  // A BILLED order was already invoiced upfront at checkout — there's no
  // separate "Complete" step waiting for it on the Orders page, so once the
  // kitchen marks it READY it's fully done and can be closed out here. The
  // linked Bill's orderStatus flips "CONFIRMED" → "COMPLETED" so the Orders
  // page reflects that the dish actually got made — no other Bill field
  // (totals, payment, etc.) is touched, since none of that changed.
  if (status === "READY" && updated.status === "BILLED") {
    const [closed] = await Promise.all([
      prisma.runningOrder.update({
        where: { id: orderId },
        data: { status: "CLOSED" },
      }),
      updated.billId
        ? prisma.bill.update({
            where: { id: updated.billId },
            data: { orderStatus: "COMPLETED" },
          })
        : Promise.resolve(null),
    ]);
    return closed;
  }

  return updated;
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

// Moves a table's entire active session (all ACTIVE/HELD orders) to a
// different, currently-unoccupied table — e.g. a guest group moves seats.
export const transferTableService = async (
  fromTableId: number,
  toTableId: number,
  restaurantId: number,
  branchId: number,
) => {
  if (fromTableId === toTableId) {
    throw new Error("Source and destination tables are the same");
  }

  return prisma.$transaction(async (tx) => {
    // Lock both table rows (consistent order — lower id first — to avoid a
    // deadlock if two transfers cross each other) before checking anything,
    // so two concurrent transfers targeting the same destination serialize
    // instead of both reading "destination free" and both writing to it.
    const lockIds = [fromTableId, toTableId].sort((a, b) => a - b);
    await tx.$executeRaw`SELECT id FROM "RestaurantTable" WHERE id IN (${lockIds[0]}, ${lockIds[1]}) FOR UPDATE`;

    const [fromTable, toTable, activeOrders, destinationBusy] = await Promise.all([
      tx.restaurantTable.findFirst({ where: { id: fromTableId, restaurantId, branchId } }),
      tx.restaurantTable.findFirst({ where: { id: toTableId, restaurantId, branchId } }),
      tx.runningOrder.findMany({
        where: { tableId: fromTableId, status: { in: ["ACTIVE", "HELD"] } },
      }),
      tx.runningOrder.count({
        where: { tableId: toTableId, status: { in: ["ACTIVE", "HELD"] } },
      }),
    ]);

    if (!fromTable) throw new Error("Source table not found");
    if (!toTable) throw new Error("Destination table not found");
    if (activeOrders.length === 0) throw new Error("No active order on the source table");
    if (destinationBusy > 0) throw new Error("Destination table already has an active order");

    await tx.runningOrder.updateMany({
      where: { id: { in: activeOrders.map((o) => o.id) } },
      data: { tableId: toTableId },
    });
    await tx.restaurantTable.update({ where: { id: toTableId }, data: { status: "OCCUPIED" } });
    await tx.restaurantTable.update({ where: { id: fromTableId }, data: { status: "AVAILABLE" } });

    return { success: true, movedOrders: activeOrders.length };
  });
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
// keepOrderActive: true → creates the Bill but marks the RunningOrder "BILLED"
// instead of "CLOSED", so kitchen still sees it as needing prep (used for
// quick/takeaway checkout, where billing happens upfront before the kitchen
// is done — see getAllRunningOrdersService/updateRunningOrderStatusService).
export const closeRunningOrderService = async (data: any) => {
  const {
    runningOrderId, tableId,
    customerName, customerPhone, paymentMethod, orderType, orderStatus,
    subtotal, discountAmount, packingCharge, serviceCharge,
    gstAmount, cgst, sgst, finalAmount, tipAmount,
    keepOrderActive, discountType, discountCode, discountApprovedById,
  } = data;

  // Resolve which orders to close
  let runningOrders: any[];
  if (tableId) {
    runningOrders = await prisma.runningOrder.findMany({
      where: { tableId, status: "ACTIVE" },
      include: { batches: { include: { items: { include: { addOns: true } } } } },
    });
  } else {
    const single = await prisma.runningOrder.findUnique({
      where: { id: runningOrderId },
      include: { batches: { include: { items: { include: { addOns: true } } } } },
    });
    // Without this check, clicking "Complete" twice in a row (e.g. a
    // double-click, or the row not disappearing before a second click) would
    // read this same still-there row again and create a second Bill for it —
    // the tableId branch above is naturally guarded by its status:"ACTIVE"
    // filter, but findUnique-by-id has no such filter, so it's checked here.
    if (single && single.status !== "ACTIVE") {
      throw new Error("This order has already been billed.");
    }
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

    const billNo = await generateBillNo(tx, primary.restaurantId, primary.branchId);
    const created = await tx.bill.create({
      data: {
        billNo,
        restaurantId: primary.restaurantId,
        branchId:     primary.branchId,
        customerId:   customer?.id ?? null,
        status:       paymentMethod ? "PAID" : "UNPAID",
        // Fall back to whatever this order's own tax/tip breakdown was
        // (stored at saveRunningOrder time for takeaway/online) before
        // computedTotal/0 — a caller that just says "close this order" by
        // id (e.g. Orders page's "Complete" button) doesn't re-send the tax
        // breakdown, and silently zeroing GST/tip here would be wrong.
        subtotal:     subtotal      ?? primary.subtotal      ?? computedTotal,
        gst:          gstAmount     ?? primary.gstAmount      ?? 0,
        cgst:         cgst          ?? primary.cgst           ?? 0,
        sgst:         sgst          ?? primary.sgst           ?? 0,
        discount:     discountAmount ?? primary.discountAmount ?? 0,
        discountType: discountType ?? "PERCENTAGE",
        discountCode: discountCode ?? null,
        discountApprovedById: discountApprovedById ?? null,
        serviceCharge: serviceCharge ?? primary.serviceCharge ?? 0,
        packingCharge: packingCharge ?? primary.packingCharge ?? 0,
        total:        finalAmount   ?? primary.finalAmount    ?? computedTotal,
        tipAmount:    tipAmount     ?? primary.tipAmount       ?? 0,
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
            notes:      item.notes,
            addOns: item.addOns?.length
              ? { create: item.addOns.map((a: any) => ({ name: a.name, price: a.price })) }
              : undefined,
          })),
        },
      },
      include: { customer: true, items: { include: { addOns: true } } },
    });

    if (discountCode) {
      await redeemDiscountCodeInTx(tx, primary.restaurantId, discountCode);
    }

    // Mark running orders CLOSED, or BILLED if keepOrderActive is set
    // (quick/takeaway bills upfront but kitchen still needs to prepare —
    // updateRunningOrderStatusService closes it out once kitchen hits READY,
    // using billId to flip this same Bill's orderStatus to "COMPLETED")
    await tx.runningOrder.updateMany({
      where: { id: { in: runningOrders.map((o) => o.id) } },
      data: { status: keepOrderActive ? "BILLED" : "CLOSED", billId: created.id },
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
