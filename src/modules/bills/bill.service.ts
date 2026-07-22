import prisma from "../../config/prisma";
import { invalidateDashboardCache } from "../analytics/analytics.service";
import { generateBillNo } from "./invoiceNumber.service";

// Creates a Bill directly from an item list — unlike closeRunningOrderService,
// this never reads a RunningOrder row from the DB, so it works even when the
// order that produced these items hasn't (or never will have) synced as its
// own RunningOrder record. That's exactly what offline billing needs: the
// frontend already has the full item/tax breakdown in local state at the
// moment of checkout, so this can run standalone once connectivity returns —
// or run immediately when online, same as before.
export const createBillService = async (data: any) => {
  const {
    customerName, customerPhone, branchId, total, paymentMethod, orderType,
    items, restaurantId, cgst, sgst, gst, serviceCharge, packingCharge,
    discount, subtotal, createdById, tableId, orderStatus, runningOrderId,
    tipAmount,
  } = data;

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
    const billNo = await generateBillNo(tx, restaurantId, branchId);

    // Frees the table and closes its ACTIVE RunningOrders (dine-in checkout
    // done this way — the offline path). Closing by tableId rather than a
    // specific id matters here: this bill may have been queued offline
    // alongside separately-queued KOT placements for the same table, which
    // sync moments before this action does — closing by table catches those
    // too, so a just-synced RunningOrder never lingers as a duplicate,
    // still-open entry next to the bill that already covers it.
    //
    // Only ACTIVE, not HELD — matches closeRunningOrderService's online
    // behavior, which only ever queries status:"ACTIVE" for a tableId close.
    // A HELD order (customer stepped away, staff paused it) is a deliberate
    // "don't touch this yet" state; leaving it out here keeps offline and
    // online billing behaving identically instead of the outcome depending
    // on whatever connectivity happened to be available at checkout time.
    if (tableId) {
      // Lock the table row first: if two devices both try to bill the same
      // table (e.g. one offline, one online, during the same outage), this
      // serializes them so the second one sees the first's result instead
      // of racing past a stale "table looks occupied" read.
      await tx.$executeRaw`SELECT id FROM "RestaurantTable" WHERE id = ${tableId} FOR UPDATE`;
      const table = await tx.restaurantTable.findFirst({ where: { id: tableId, restaurantId, branchId } });
      if (!table) throw new Error("Table not found");
      const stillActive = await tx.runningOrder.count({
        where: { tableId, restaurantId, branchId, status: "ACTIVE" },
      });
      if (table.status === "AVAILABLE" && stillActive === 0) {
        throw new Error("This table has already been billed — nothing left to bill.");
      }

      await tx.restaurantTable.updateMany({
        where: { id: tableId, restaurantId, branchId },
        data: { status: "AVAILABLE" },
      });
      await tx.runningOrder.updateMany({
        where: { tableId, restaurantId, branchId, status: "ACTIVE" },
        data: { status: "CLOSED" },
      });
    }

    // Closes the RunningOrder this bill was completed from (e.g. Orders
    // page's "Complete" action done offline) so it doesn't keep showing up
    // as a separate, still-open entry once this syncs.
    if (runningOrderId) {
      await tx.runningOrder.updateMany({
        where: { id: runningOrderId, restaurantId, branchId },
        data: { status: "CLOSED" },
      });
    }

    const created = await tx.bill.create({
      data: {
        billNo,
        restaurantId,
        customerId: customer?.id ?? null,
        branchId,
        createdById: createdById ?? null,
        status: "PAID",
        subtotal: subtotal ?? total,
        gst: gst ?? 0,
        cgst: cgst ?? 0,
        sgst: sgst ?? 0,
        serviceCharge: serviceCharge ?? 0,
        packingCharge: packingCharge ?? 0,
        discount: discount ?? 0,
        total,
        tipAmount: tipAmount ?? 0,
        paymentMethod,
        orderType,
        orderStatus: orderStatus ?? "COMPLETED",
        items: {
          create: items.map((item: any) => ({
            menuItemId: item.menuItemId,
            itemName: item?.itemName,
            quantity: item.quantity,
            price: item.price,
            total: item.total ?? item.price * item.quantity,
            notes: item.notes || null,
            addOns: item.addOns?.length
              ? { create: item.addOns.map((a: any) => ({ name: a.name, price: a.price })) }
              : undefined,
          })),
        },
      },
      include: { customer: true, items: { include: { addOns: true } } },
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
    billNo: bill.billNo,
    orderNo: bill.billNo,
    orderType: bill.orderType,
    customer: bill.customer?.name || "Walk-in",
    customerPhone: bill.customer?.phone || "",
    paymentMethod: bill.paymentMethod,
    paymentStatus: bill.status,
    orderStatus: bill.orderStatus,
    subtotal: bill.subtotal,
    discount: bill.discount,
    gst: bill.gst,
    cgst: bill.cgst,
    sgst: bill.sgst,
    serviceCharge: bill.serviceCharge,
    packingCharge: bill.packingCharge,
    total: bill.total,
    tipAmount: bill.tipAmount,
    notes: bill.notes,
    table: "-",
    items: bill.items,
    createdAt: bill.createdAt,
  }));

  const formattedRunningOrders = runningOrders.map((order) => {
    const allItems = order.batches.flatMap((batch: any) => batch.items);
    const itemTotal = allItems.reduce((acc: number, item: any) => acc + item.total, 0);
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
      subtotal: order.subtotal ?? itemTotal,
      discount: order.discountAmount ?? 0,
      gst: order.gstAmount ?? 0,
      cgst: order.cgst ?? 0,
      sgst: order.sgst ?? 0,
      serviceCharge: order.serviceCharge ?? 0,
      packingCharge: order.packingCharge ?? 0,
      total: order.finalAmount ?? itemTotal,
      tipAmount: order.tipAmount ?? 0,
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
        subtotal: true,
        gst: true,
        cgst: true,
        sgst: true,
        discount: true,
        serviceCharge: true,
        packingCharge: true,
        total: true,
        tipAmount: true,
        notes: true,
        createdAt: true,
        customer: { select: { name: true, phone: true } },
        items: { include: { addOns: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: (page - 1) * limit,
    }),
    prisma.runningOrder.findMany({
      // Excludes BILLED too — once a quick/takeaway order is invoiced
      // upfront (see closeRunningOrderService's keepOrderActive), it should
      // show only via its Bill row here, not also as a lingering
      // RUNNING_ORDER row while the kitchen finishes preparing it.
      where: { restaurantId, ...branchFilter, status: { in: ["ACTIVE", "HELD"] } },
      select: {
        id: true,
        orderType: true,
        customerName: true,
        customerPhone: true,
        paymentMethod: true,
        kitchenStatus: true,
        createdAt: true,
        // Populated only for non-dine-in orders (see saveRunningOrderService's
        // isNotDineIn branch) — exposed so "Complete" can build a bill
        // offline from data already in hand, without a fresh server read.
        subtotal: true,
        discountAmount: true,
        packingCharge: true,
        serviceCharge: true,
        gstAmount: true,
        cgst: true,
        sgst: true,
        finalAmount: true,
        tipAmount: true,
        table: { select: { name: true } },
        batches: {
          select: {
            items: {
              select: {
                id: true, menuItemId: true, itemName: true, quantity: true,
                price: true, total: true, status: true, notes: true,
                addOns: true,
              },
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

// ─── createBillRefundService ─────────────────────────────────────────────────
// Partial (or full) refund against an already-paid bill. `total` is reduced
// by the exact refund amount so every existing revenue query (which just
// sums `bill.total`) stays correct with no changes elsewhere. subtotal,
// discount, cgst, sgst and gst are scaled down by the same ratio the refund
// represents of the bill's CURRENT total, so the receipt's own internal math
// (subtotal − discount + gst ≈ total) and GST-collected reporting keep pace
// with the money actually retained — a proportional credit note, not a full
// itemized recompute.
export const createBillRefundService = async (
  billId: number,
  amount: number,
  reason: string | undefined,
  createdById: number | undefined,
) => {
  const updated = await prisma.$transaction(async (tx) => {
    // Lock the row before reading — without this, two refunds submitted at
    // nearly the same time both read the same starting `total`/`subtotal`
    // and compute their own "final" numbers independently; the second
    // transaction's plain (non-incrementing) writes would silently
    // overwrite the first refund's math instead of stacking on top of it.
    await tx.$executeRaw`SELECT id FROM "Bill" WHERE id = ${billId} FOR UPDATE`;
    const bill = await tx.bill.findUnique({ where: { id: billId } });

    if (!bill) throw new Error("Bill not found");
    if (bill.status === "CANCELLED") throw new Error("Cannot refund a cancelled bill");
    if (!(amount > 0)) throw new Error("Refund amount must be greater than 0");
    if (amount > bill.total) {
      throw new Error(
        `Refund amount exceeds the remaining refundable amount (₹${bill.total.toFixed(2)})`,
      );
    }

    const ratio = 1 - amount / bill.total;

    await tx.billRefund.create({
      data: { billId, amount, reason: reason || null, createdById },
    });

    return tx.bill.update({
      where: { id: billId },
      data: {
        refundedAmount: { increment: amount },
        total: Math.max(0, bill.total - amount),
        subtotal: Math.max(0, bill.subtotal * ratio),
        discount: Math.max(0, bill.discount * ratio),
        gst: Math.max(0, bill.gst * ratio),
        cgst: bill.cgst != null ? Math.max(0, bill.cgst * ratio) : bill.cgst,
        sgst: bill.sgst != null ? Math.max(0, bill.sgst * ratio) : bill.sgst,
      },
    });
  });

  invalidateDashboardCache(updated.restaurantId);
  return updated;
};

export const getBillRefundsService = async (billId: number) => {
  return prisma.billRefund.findMany({
    where: { billId },
    orderBy: { createdAt: "desc" },
  });
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
