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
        orderStatus: "ACTIVE",
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
  // Return ALL active orders — kitchen filters PENDING/PREPARING client-side;
  // billing page needs READY/DELIVERED too for correct table colours.
  const orders = await prisma.runningOrder.findMany({
    where: { restaurantId, branchId, status: "ACTIVE" },
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

export const updateRunningOrderStatusService = async (
  orderId: number,
  status: string,
) => {
  return prisma.runningOrder.update({
    where: { id: orderId },
    data: { kitchenStatus: status },
  });
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
  );
  const computedTotal = runningOrders.reduce(
    (sum, o) => sum + (o.totalAmount ?? 0), 0,
  );

  const [customer] = await Promise.all([
    customerPhone
      ? prisma.customer.upsert({
          where: { phone: customerPhone },
          update: {},
          create: {
            name: customerName || "",
            phone: customerPhone,
            restaurant: { connect: { id: primary.restaurantId } },
          },
        })
      : Promise.resolve(null),
    tableId
      ? prisma.restaurantTable.updateMany({
          where: {
            id: tableId,
            restaurantId: primary.restaurantId,
            branchId: primary.branchId,
          },
          data: { status: "AVAILABLE" },
        })
      : primary.tableId
        ? prisma.restaurantTable.updateMany({
            where: {
              id: primary.tableId,
              restaurantId: primary.restaurantId,
              branchId: primary.branchId,
            },
            data: { status: "AVAILABLE" },
          })
        : Promise.resolve(null),
  ]);

  const bill = await prisma.$transaction(async (tx) => {
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

    // Delete all resolved running orders (cascade removes batches + items)
    await tx.runningOrder.deleteMany({
      where: { id: { in: runningOrders.map((o) => o.id) } },
    });

    return created;
  });

  invalidateDashboardCache(primary.restaurantId);
  return bill;
};
