import prisma from "../../config/prisma";
import { invalidateDashboardCache } from "../analytics/analytics.service";

export const saveRunningOrderService = async (data: any) => {
  const {
    restaurantId,
    branchId,
    createdById,
    tableId,
    items,
    orderType,
    customerName,
    customerPhone,
    paymentMethod,
    subtotal,
    discountAmount,
    packingCharge,
    serviceCharge,
    gstAmount,
    cgst,
    sgst,
    finalAmount,
  } = data;

  let runningOrder = await prisma.runningOrder.findFirst({
    where: { restaurantId, branchId, tableId, status: "ACTIVE" },
  });

  if (!runningOrder) {
    const isNotDineIn = orderType !== "DINE_IN";

    // Create the order and update the table status in parallel
    const [created] = await Promise.all([
      prisma.runningOrder.create({
        data: {
          restaurantId,
          branchId,
          createdById,
          tableId,
          orderType,
          customerName,
          customerPhone,
          paymentMethod,
          orderStatus: "ACTIVE",
          status: "ACTIVE",
          totalAmount: 0,
          paymentStatus: isNotDineIn ? "PAID" : "UNPAID",
          subtotal: isNotDineIn ? subtotal : null,
          discountAmount: isNotDineIn ? discountAmount : null,
          packingCharge: isNotDineIn ? packingCharge : null,
          serviceCharge: isNotDineIn ? serviceCharge : null,
          gstAmount: isNotDineIn ? gstAmount : null,
          cgst: isNotDineIn ? cgst : null,
          sgst: isNotDineIn ? sgst : null,
          finalAmount: isNotDineIn ? finalAmount : null,
        },
      }),
      orderType === "DINE_IN" && tableId
        ? prisma.restaurantTable.updateMany({
            where: { id: tableId, restaurantId, branchId },
            data: { status: "OCCUPIED" },
          })
        : Promise.resolve(null),
    ]);

    runningOrder = created;
  }

  const batchTotal = items.reduce(
    (sum: number, item: any) => sum + item.quantity * item.price,
    0,
  );

  // Create batch + update total atomically
  await prisma.$transaction([
    prisma.runningOrderBatch.create({
      data: {
        runningOrderId: runningOrder.id,
        items: {
          create: items.map((item: any) => ({
            menuItemId: item.menuItemId,
            itemName: item.itemName,
            quantity: item.quantity,
            price: item.price,
            total: item.quantity * item.price,
          })),
        },
      },
    }),
    prisma.runningOrder.update({
      where: { id: runningOrder.id },
      data: { totalAmount: { increment: batchTotal } },
    }),
  ]);

  return prisma.runningOrder.findUnique({
    where: { id: runningOrder.id },
    include: {
      batches: {
        include: { items: true },
        orderBy: { createdAt: "desc" },
      },
      table: true,
    },
  });
};

export const getRunningOrderByTableService = async (tableId: number) => {
  return prisma.runningOrder.findFirst({
    where: { tableId, status: "ACTIVE" },
    include: {
      batches: {
        include: { items: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
};

export const closeRunningOrderService = async (data: any) => {
  const {
    runningOrderId,
    customerName,
    customerPhone,
    paymentMethod,
    orderType,
    orderStatus,
  } = data;

  const runningOrder = await prisma.runningOrder.findUnique({
    where: { id: runningOrderId },
    include: { batches: { include: { items: true } } },
  });

  if (!runningOrder) throw new Error("Running order not found");

  // Customer upsert + table status update run in parallel
  const [customer] = await Promise.all([
    customerPhone
      ? prisma.customer.upsert({
          where: { phone: customerPhone },
          update: {},
          create: {
            name: customerName || "",
            phone: customerPhone,
            restaurant: { connect: { id: runningOrder.restaurantId } },
          },
        })
      : Promise.resolve(null),
    runningOrder.tableId
      ? prisma.restaurantTable.updateMany({
          where: {
            id: runningOrder.tableId,
            restaurantId: runningOrder.restaurantId,
            branchId: runningOrder.branchId,
          },
          data: { status: "AVAILABLE" },
        })
      : Promise.resolve(null),
  ]);

  const allItems = runningOrder.batches.flatMap((batch) => batch.items);

  // Create bill + delete running order (cascade removes batches + items)
  const bill = await prisma.$transaction(async (tx) => {
    const created = await tx.bill.create({
      data: {
        billNo: `BILL-${Date.now()}`,
        restaurantId: runningOrder.restaurantId,
        branchId: runningOrder.branchId,
        customerId: customer?.id ?? null,
        status: paymentMethod ? "PAID" : "UNPAID",
        subtotal: runningOrder.subtotal || 0,
        gst: runningOrder.gstAmount || 0,
        cgst: runningOrder.cgst || 0,
        sgst: runningOrder.sgst || 0,
        discount: runningOrder.discountAmount || 0,
        serviceCharge: runningOrder.serviceCharge || 0,
        packingCharge: runningOrder.packingCharge || 0,
        total: runningOrder.finalAmount || runningOrder.totalAmount || 0,
        paymentMethod,
        orderType,
        orderStatus: orderStatus || "COMPLETED",
        createdById: runningOrder.createdById,
        items: {
          create: allItems.map((item) => ({
            menuItemId: item.menuItemId,
            itemName: item.itemName,
            quantity: item.quantity,
            price: item.price,
            total: item.total,
          })),
        },
      },
      include: { customer: true, items: true },
    });

    // Single delete — cascade handles RunningOrderBatch + RunningOrderBatchItem
    await tx.runningOrder.delete({ where: { id: runningOrder.id } });

    return created;
  });

  // Bust the dashboard cache so the next request sees the new bill immediately
  invalidateDashboardCache(runningOrder.restaurantId);

  return bill;
};
