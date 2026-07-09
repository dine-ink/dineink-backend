import prisma from "../../config/prisma";
import { invalidateDashboardCache } from "../analytics/analytics.service";

export const createBillService = async (data: any) => {
  const { customerName, customerPhone, branchId, total, paymentMethod, orderType, items, restaurantId, cgst, sgst, serviceCharge, packingCharge, discount } = data;

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

  const bill = await prisma.$transaction(async (tx) => {
    const created = await tx.bill.create({
      data: {
        billNo: `BILL-${Date.now()}`,
        restaurantId,
        customerId: customer?.id ?? null,
        branchId,
        status: "PAID",
        subtotal: total,
        gst: 0,
        cgst: cgst ?? 0,
        sgst: sgst ?? 0,
        serviceCharge: serviceCharge ?? 0,
        packingCharge: packingCharge ?? 0,
        discount: discount ?? 0,
        total,
        paymentMethod,
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

    // ── Auto-deduct ingredients ───────────────────────────────────────────────
    const menuItemIds = items
      .filter((item: any) => item.menuItemId)
      .map((item: any) => item.menuItemId as number);

    if (menuItemIds.length > 0) {
      const mappings = await tx.menuItemIngredient.findMany({
        where: { menuItemId: { in: menuItemIds } },
      });

      if (mappings.length > 0) {
        const soldQtyMap = new Map<number, number>();
        for (const item of items as any[]) {
          if (item.menuItemId) {
            soldQtyMap.set(item.menuItemId, (soldQtyMap.get(item.menuItemId) ?? 0) + item.quantity);
          }
        }

        const ingredientDeductions = new Map<number, number>();
        for (const mapping of mappings) {
          const soldQty = soldQtyMap.get(mapping.menuItemId) ?? 0;
          ingredientDeductions.set(
            mapping.ingredientId,
            (ingredientDeductions.get(mapping.ingredientId) ?? 0) + mapping.quantity * soldQty,
          );
        }

        await Promise.all([
          ...Array.from(ingredientDeductions.entries()).map(([ingredientId, qty]) =>
            tx.ingredient.update({
              where: { id: ingredientId },
              data: { quantity: { decrement: qty } },
            }),
          ),
          tx.inventoryAdjustment.createMany({
            data: Array.from(ingredientDeductions.entries()).map(([ingredientId, qty]) => ({
              restaurantId,
              branchId,
              ingredientId,
              quantity: qty,
              adjustmentType: "SALE_DEDUCTION",
              reason: `Auto-deducted: bill ${created.billNo}`,
            })),
          }),
        ]);
      }
    }

    return created;
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
      orderStatus: order.kitchenStatus,
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
      where: { restaurantId, ...branchFilter, status: { not: "CLOSED" } },
      select: {
        id: true,
        orderType: true,
        customerName: true,
        customerPhone: true,
        paymentMethod: true,
        kitchenStatus: true,
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

// ─── cancelBillService ───────────────────────────────────────────────────────

export const cancelBillService = async (billId: number) => {
  const bill = await prisma.bill.findUnique({ where: { id: billId } });
  if (!bill) throw new Error("Bill not found");
  if (bill.status === "CANCELLED") throw new Error("Bill is already cancelled");

  const updated = await prisma.bill.update({
    where: { id: billId },
    data: { status: "CANCELLED" },
  });

  invalidateDashboardCache(bill.restaurantId);
  return updated;
};

// ─── getReportBillsService ───────────────────────────────────────────────────
// Raw bills with all financial fields — used by the Reports/P&L page.
// Excludes CANCELLED bills so they don't inflate revenue figures.

export const getReportBillsService = async (
  restaurantId: number,
  branchId?: number,
  from?: string,
  to?: string,
) => {
  const dateFilter =
    from && to
      ? {
          createdAt: {
            gte: new Date(from),
            lte: new Date(new Date(to).setHours(23, 59, 59, 999)),
          },
        }
      : {};

  return prisma.bill.findMany({
    where: {
      restaurantId,
      ...(branchId ? { branchId } : {}),
      ...dateFilter,
      status: { not: "CANCELLED" },
    },
    select: {
      id: true,
      billNo: true,
      orderType: true,
      paymentMethod: true,
      status: true,
      orderStatus: true,
      subtotal: true,
      cgst: true,
      sgst: true,
      gst: true,
      discount: true,
      serviceCharge: true,
      packingCharge: true,
      total: true,
      notes: true,
      createdAt: true,
      customer: { select: { id: true, name: true, phone: true } },
      items: {
        select: {
          id: true,
          menuItemId: true,
          itemName: true,
          quantity: true,
          price: true,
          total: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
};
