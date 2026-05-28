import prisma from "../../config/prisma";
import { invalidateDashboardCache } from "../analytics/analytics.service";

export const createBillService = async (data: any) => {
  const { customerName, customerPhone, branchId, total, paymentMode, orderType, items, restaurantId } = data;

  // Parallel: customer lookup and bill creation don't depend on branch query
  // branchData was only used for restaurantId — which is already in the payload
  const customer = customerPhone
    ? await prisma.customer.upsert({
        where: { phone: customerPhone },
        update: {},
        create: {
          name: customerName || "",
          phone: customerPhone,
          restaurant: { connect: { id: restaurantId } },
        },
      })
    : null;

  const bill = await prisma.bill.create({
    data: {
      billNo: `BILL-${Date.now()}`,
      restaurantId,
      customerId: customer?.id ?? null,
      branchId,
      status: "PAID",
      subtotal: total,
      gst: 0,
      discount: 0,
      total,
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
    include: { customer: true, items: true },
  });

  invalidateDashboardCache(restaurantId);
  return bill;
};

// ─── Shared formatter ─────────────────────────────────────────────────────────

function formatBillsAndOrders(bills: any[], runningOrders: any[]) {
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

  const formattedRunningOrders = runningOrders.map((order) => {
    const allItems = order.batches.flatMap((batch: any) => batch.items);
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
      total: allItems.reduce((acc: number, item: any) => acc + item.total, 0),
      table: order.table?.name || "-",
      items: allItems,
      createdAt: order.createdAt,
    };
  });

  return [...formattedRunningOrders, ...formattedBills].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

// ─── getBillsService ──────────────────────────────────────────────────────────

export const getBillsService = async (
  restaurantId: number,
  branchId?: number,
  page = 1,
  limit = 200,
) => {
  const branchFilter = branchId ? { branchId } : {};

  const [bills, runningOrders] = await Promise.all([
    prisma.bill.findMany({
      where: { restaurantId, ...branchFilter },
      select: {
        id: true,
        billNo: true,
        orderType: true,
        paymentMethod: true,
        status: true,
        orderStatus: true,
        total: true,
        createdAt: true,
        customer: { select: { name: true, phone: true } },
        items: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: (page - 1) * limit,
    }),
    prisma.runningOrder.findMany({
      where: { restaurantId, ...branchFilter },
      select: {
        id: true,
        orderType: true,
        customerName: true,
        customerPhone: true,
        paymentMethod: true,
        orderStatus: true,
        createdAt: true,
        table: { select: { name: true } },
        batches: {
          select: {
            items: {
              select: { id: true, menuItemId: true, itemName: true, quantity: true, price: true, total: true, status: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return formatBillsAndOrders(bills, runningOrders);
};

// ─── getBranchWiseBillsService ────────────────────────────────────────────────

export const getBranchWiseBillsService = async (restaurantId: number, branchId: number) => {
  return getBillsService(restaurantId, branchId);
};
