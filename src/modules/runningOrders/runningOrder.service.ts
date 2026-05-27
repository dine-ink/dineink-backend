import prisma from "../../config/prisma";

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
    customerAddress,
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
    where: {
      restaurantId,
      branchId,
      tableId,
      status: "ACTIVE",
    },
  });

  // CREATE NEW RUNNING ORDER
  if (!runningOrder) {
    runningOrder = await prisma.runningOrder.create({
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
        paymentStatus: orderType === "DINE_IN" ? "UNPAID" : "PAID",
        subtotal: orderType !== "DINE_IN" ? subtotal : null,

        discountAmount: orderType !== "DINE_IN" ? discountAmount : null,

        packingCharge: orderType !== "DINE_IN" ? packingCharge : null,

        serviceCharge: orderType !== "DINE_IN" ? serviceCharge : null,

        gstAmount: orderType !== "DINE_IN" ? gstAmount : null,

        cgst: orderType !== "DINE_IN" ? cgst : null,

        sgst: orderType !== "DINE_IN" ? sgst : null,

        finalAmount: orderType !== "DINE_IN" ? finalAmount : null,
      },
    });

    // UPDATE TABLE STATUS
    if (orderType === "DINE_IN" && tableId) {
      await prisma.restaurantTable.updateMany({
        where: {
          id: tableId,
          restaurantId,
          branchId,
        },

        data: {
          status: "OCCUPIED",
        },
      });
    }
  }

  // CREATE BATCH
  const batch = await prisma.runningOrderBatch.create({
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

    include: {
      items: true,
    },
  });

  // UPDATE RUNNING ORDER TOTAL
  const batchTotal = items.reduce(
    (sum: number, item: any) => sum + item.quantity * item.price,
    0,
  );

  await prisma.runningOrder.update({
    where: {
      id: runningOrder.id,
    },
    data: {
      totalAmount: {
        increment: batchTotal,
      },
    },
  });

  // RETURN UPDATED ORDER
  return await prisma.runningOrder.findUnique({
    where: {
      id: runningOrder.id,
    },
    include: {
      batches: {
        include: {
          items: true,
        },

        orderBy: {
          createdAt: "desc",
        },
      },
      table: true,
    },
  });
};

export const getRunningOrderByTableService = async (tableId: number) => {
  return await prisma.runningOrder.findFirst({
    where: {
      tableId,
      status: "ACTIVE",
    },
    include: {
      batches: {
        include: {
          items: true,
        },
        orderBy: {
          createdAt: "desc",
        },
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

    subtotal,
    gstAmount,
    cgst,
    sgst,
    discountAmount,
    serviceCharge,
    packingCharge,
    finalAmount,
  } = data;
  const runningOrder = await prisma.runningOrder.findUnique({
    where: {
      id: runningOrderId,
    },
    include: {
      batches: {
        include: {
          items: true,
        },
      },
    },
  });
  if (!runningOrder) {
    throw new Error("Running order not found");
  }
  let customer = await prisma.customer.findFirst({
    where: {
      phone: customerPhone,
    },
  });
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        name: customerName,
        phone: customerPhone,

        restaurant: {
          connect: {
            id: runningOrder.restaurantId,
          },
        },
      },
    });
  }
  const allItems = runningOrder.batches.flatMap((batch) => batch.items);
  const bill = await prisma.bill.create({
    data: {
      billNo: `BILL-${Date.now()}`,
      restaurantId: runningOrder.restaurantId,
      branchId: runningOrder.branchId,
      customerId: customer.id,
      status: paymentMethod ? "PAID" : "UNPAID",
      subtotal,

      gst: gstAmount,

      cgst,

      sgst,

      discount: discountAmount,

      serviceCharge,

      packingCharge,

      total: finalAmount,
      paymentMethod,
      orderType,
      orderStatus: orderStatus,
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
    include: {
      customer: true,
      items: true,
    },
  });
  if (runningOrder.tableId) {
    await prisma.restaurantTable.updateMany({
      where: {
        id: runningOrder.tableId,
        restaurantId: runningOrder.restaurantId,
        branchId: runningOrder.branchId,
      },
      data: {
        status: "AVAILABLE",
      },
    });
  }
  await prisma.runningOrderBatchItem.deleteMany({
    where: {
      runningOrderBatch: {
        runningOrderId: runningOrder.id,
      },
    },
  });
  await prisma.runningOrderBatch.deleteMany({
    where: {
      runningOrderId: runningOrder.id,
    },
  });
  await prisma.runningOrder.delete({
    where: {
      id: runningOrder.id,
    },
  });
  return bill;
};
