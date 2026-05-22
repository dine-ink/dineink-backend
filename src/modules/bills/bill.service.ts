import prisma from "../../config/prisma";

export const createBillService = async (data: any) => {
  const {
    customerName,
    customerPhone,
    branchId,
    total,
    paymentMode,
    orderType,
    items,
    restaurantId,
  } = data;
  console.log("in");
  console.log(data, "items");
  let customer = await prisma.customer.findFirst({
    where: {
      phone: customerPhone,
    },
  });

  const branchData = await prisma.branch.findFirst({
    where: {
      id: branchId,
      restaurantId: restaurantId,
    },
  });

  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        name: customerName,
        phone: customerPhone,

        restaurant: {
          connect: {
            id: branchData?.restaurantId,
          },
        },
      },
    });
  }

  const bill = await prisma.bill.create({
    data: {
      billNo: `BILL-${Date.now()}`,
      restaurantId: restaurantId,
      customerId: customer.id,
      branchId,
      status: "PAID",
      subtotal: total,
      gst: 0,
      discount: 0,
      total: total,
      paymentMethod: paymentMode,
      orderType,
      items: {
        create: items.map((item: any) => ({
          menuItemId: item.menuItemId,
          itemName: item?.itemName,
          quantity: item.quantity,
          price: item.price,
          total: item.price * item.quantity,
        })),
      },
    },
    include: {
      customer: true,
      items: true,
    },
  });
  return bill;
};

export const getBillsService = async (
  restaurantId: number,
  branchId?: number,
) => {
  // COMPLETED BILLS

  const bills = await prisma.bill.findMany({
    where: {
      restaurantId,

      ...(branchId && {
        branchId,
      }),
    },

    include: {
      customer: true,
      items: true,
      branch: true,
    },

    orderBy: {
      createdAt: "desc",
    },
  });

  // RUNNING ORDERS

  const runningOrders = await prisma.runningOrder.findMany({
    where: {
      restaurantId,

      ...(branchId && {
        branchId,
      }),
    },

    include: {
      table: true,

      batches: {
        include: {
          items: true,
        },
      },
    },

    orderBy: {
      createdAt: "desc",
    },
  });

  // FORMAT BILLS

  const formattedBills = bills.map((bill) => ({
    id: bill.id,

    source: "BILL",

    orderNo: bill.billNo,

    orderType: bill.orderType,

    customer: bill.customer?.name || "Walk-in",

    customerPhone: bill.customer?.phone || "",

    paymentMethod: bill.paymentMethod,

    paymentStatus: bill.status,

    orderStatus: bill.orderStatus,

    total: bill.total,

    table: "-",

    items: bill.items,

    createdAt: bill.createdAt,
  }));

  // FORMAT RUNNING ORDERS

  const formattedRunningOrders = runningOrders.map((order) => {
    const allItems = order.batches.flatMap((batch) => batch.items);

    const total = allItems.reduce((acc, item) => acc + item.total, 0);

    return {
      id: order.id,

      source: "RUNNING_ORDER",

      orderNo: `RUN-${order.id}`,

      orderType: order.orderType,

      customer: order.customerName || "Walk-in",

      customerPhone: order.customerPhone || "",

      paymentMethod: order.paymentMethod || "-",

      paymentStatus: "-",

      orderStatus: order.orderStatus,

      total,

      table: order.table?.name || "-",

      items: allItems,

      createdAt: order.createdAt,
    };
  });

  // COMBINE BOTH

  return [...formattedRunningOrders, ...formattedBills].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
};
export const getBranchWiseBillsService = async (
  restaurantId: number,
  branchId: number,
) => {
  // COMPLETED BILLS
  const bills = await prisma.bill.findMany({
    where: {
      restaurantId,
      branchId: branchId,
    },
    include: {
      customer: true,
      items: true,
      branch: true,
    },

    orderBy: {
      createdAt: "desc",
    },
  });
  // RUNNING ORDERS
  const runningOrders = await prisma.runningOrder.findMany({
    where: {
      restaurantId,
      branchId: branchId,
    },
    include: {
      table: true,
      batches: {
        include: {
          items: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
  // FORMAT BILLS
  const formattedBills = bills.map((bill) => ({
    id: bill.id,
    source: "BILL",
    orderNo: bill.billNo,
    orderType: bill.orderType,
    customer: bill.customer?.name || "Walk-in",
    customerPhone: bill.customer?.phone || "",
    paymentMethod: bill.paymentMethod,
    paymentStatus: bill.status,
    orderStatus: bill.orderStatus,
    total: bill.total,
    table: "-",
    items: bill.items,
    createdAt: bill.createdAt,
  }));
  // FORMAT RUNNING ORDERS
  const formattedRunningOrders = runningOrders.map((order) => {
    const allItems = order.batches.flatMap((batch) => batch.items);
    const total = allItems.reduce((acc, item) => acc + item.total, 0);
    return {
      id: order.id,
      source: "RUNNING_ORDER",
      orderNo: `RUN-${order.id}`,
      orderType: order.orderType,
      customer: order.customerName || "Walk-in",
      customerPhone: order.customerPhone || "",
      paymentMethod: order.paymentMethod || "-",
      paymentStatus: "-",
      orderStatus: order.orderStatus,
      total,
      table: order.table?.name || "-",
      items: allItems,
      createdAt: order.createdAt,
    };
  });
  // COMBINE BOTH
  return [...formattedRunningOrders, ...formattedBills].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
};
