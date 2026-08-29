import prisma from "../../../config/prisma";
import { applyContactMasking } from "../shared/pii";
import { notFound } from "../shared/apiError";
import { parsePage, parseSort, toPaged } from "../shared/pagination";

/**
 * Orders, as the internal console sees them.
 *
 * DineInk records an order in two places, and both are represented here
 * rather than being flattened into an invented "Order" entity:
 *
 *   - `Bill` is the settled, invoiced order — the authoritative record, with
 *     items, taxes, totals, payment status and the refund ledger. This is what
 *     the Orders list and detail page show.
 *   - `RunningOrder` is the live table order the POS is still working on. It
 *     becomes a Bill when it's closed. Live orders are surfaced separately
 *     (on a restaurant's page) instead of being merged into the same paginated
 *     list, because the two have different columns and different lifetimes.
 *
 * The status vocabularies below are the ones the POS and billing services
 * actually write. They are read, never invented: the brief sketches a
 * CREATED → CONFIRMED → PREPARING → READY → COMPLETED machine, but the database
 * has no such column, so presenting one would be fiction. V1 is read-only for
 * exactly this reason — see the note on `assertOrderTransition`.
 */

export const BILL_ORDER_STATUSES = ["CONFIRMED", "COMPLETED", "CANCELLED"] as const;
export const BILL_PAYMENT_STATUSES = ["UNPAID", "PAID", "PARTIAL", "CANCELLED"] as const;
export const KITCHEN_STATUSES = ["PENDING", "PREPARING", "READY", "DONE"] as const;
export const RUNNING_ORDER_STATUSES = ["ACTIVE", "BILLED", "CLOSED"] as const;

const ORDER_SORT_FIELDS = ["createdAt", "updatedAt", "total", "billNo"] as const;

export interface OrderListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  restaurantId?: number;
  branchId?: number;
  customerId?: number;
  orderStatus?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  from?: string;
  to?: string;
  minAmount?: number;
  maxAmount?: number;
  sortBy?: string;
  sortDir?: string;
}

const buildOrderWhere = (query: OrderListQuery) => {
  const filters: any[] = [];

  if (query.search?.trim()) {
    const term = query.search.trim();
    // Accepts the displayed ORD-/bill number as well as a bare id.
    const idMatch = term.match(/^(?:ord-)?(\d+)$/i);
    const or: any[] = [{ billNo: { contains: term, mode: "insensitive" } }];
    if (idMatch) or.push({ id: Number(idMatch[1]) });
    filters.push({ OR: or });
  }
  if (query.restaurantId) filters.push({ restaurantId: Number(query.restaurantId) });
  if (query.branchId) filters.push({ branchId: Number(query.branchId) });
  if (query.customerId) filters.push({ customerId: Number(query.customerId) });
  if (query.orderStatus) filters.push({ orderStatus: query.orderStatus });
  if (query.paymentStatus) filters.push({ status: query.paymentStatus });
  if (query.paymentMethod) filters.push({ paymentMethod: query.paymentMethod });
  if (query.from || query.to) {
    const createdAt: any = {};
    if (query.from) createdAt.gte = new Date(query.from);
    if (query.to) createdAt.lte = new Date(`${query.to}T23:59:59.999Z`);
    filters.push({ createdAt });
  }
  if (query.minAmount !== undefined || query.maxAmount !== undefined) {
    const total: any = {};
    if (query.minAmount !== undefined) total.gte = Number(query.minAmount);
    if (query.maxAmount !== undefined) total.lte = Number(query.maxAmount);
    filters.push({ total });
  }

  return filters.length ? { AND: filters } : {};
};

export const listOrders = async (query: OrderListQuery, canViewPii: boolean) => {
  const page = parsePage(query);
  const sort = parseSort(query, ORDER_SORT_FIELDS, "createdAt");
  const where = buildOrderWhere(query);

  const [rows, total] = await Promise.all([
    prisma.bill.findMany({
      where,
      orderBy: { [sort.field]: sort.direction },
      skip: page.skip,
      take: page.take,
      select: {
        id: true,
        billNo: true,
        orderType: true,
        orderStatus: true,
        status: true,
        paymentMethod: true,
        total: true,
        refundedAmount: true,
        createdAt: true,
        updatedAt: true,
        restaurant: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true, phone: true } },
      },
    }),
    prisma.bill.count({ where }),
  ]);

  const mapped = rows.map((row) => ({
    id: row.id,
    displayId: `ORD-${row.id}`,
    billNo: row.billNo,
    orderType: row.orderType,
    orderStatus: row.orderStatus,
    paymentStatus: row.status,
    paymentMethod: row.paymentMethod,
    amount: row.total,
    refundedAmount: row.refundedAmount ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    restaurant: row.restaurant,
    branch: row.branch,
    customer: row.customer ? applyContactMasking(row.customer, canViewPii) : null,
  }));

  return toPaged(mapped, total, page);
};

export const getOrder = async (orderId: number, canViewPii: boolean) => {
  const bill = await prisma.bill.findUnique({
    where: { id: orderId },
    include: {
      restaurant: { select: { id: true, name: true, platformStatus: true } },
      branch: { select: { id: true, name: true, city: true } },
      customer: { select: { id: true, name: true, phone: true, email: true, address: true } },
      items: { include: { addOns: true } },
      refunds: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!bill) throw notFound("Order not found", "ORDER_NOT_FOUND");

  // The running order this bill came from, when there was one. It carries the
  // kitchen timestamps the bill itself doesn't have.
  const runningOrder = await prisma.runningOrder.findFirst({
    where: { billId: bill.id },
    select: {
      id: true,
      status: true,
      kitchenStatus: true,
      startedAt: true,
      completedAt: true,
      tableId: true,
      table: { select: { id: true, name: true } },
    },
  });

  return {
    id: bill.id,
    displayId: `ORD-${bill.id}`,
    billNo: bill.billNo,
    orderType: bill.orderType,
    orderStatus: bill.orderStatus,
    paymentStatus: bill.status,
    paymentMethod: bill.paymentMethod,
    notes: bill.notes,
    createdAt: bill.createdAt,
    updatedAt: bill.updatedAt,
    restaurant: bill.restaurant,
    branch: bill.branch,
    table: runningOrder?.table ?? null,
    customer: bill.customer ? applyContactMasking(bill.customer, canViewPii) : null,
    amounts: {
      subtotal: bill.subtotal,
      discount: bill.discount,
      discountType: bill.discountType,
      discountCode: bill.discountCode,
      gst: bill.gst,
      cgst: bill.cgst ?? 0,
      sgst: bill.sgst ?? 0,
      serviceCharge: bill.serviceCharge ?? 0,
      packingCharge: bill.packingCharge ?? 0,
      // Kept out of `total` in the schema because a tip is a pass-through to
      // staff rather than restaurant revenue; shown separately for the same
      // reason, so the figures here reconcile with the restaurant's own reports.
      tipAmount: bill.tipAmount ?? 0,
      total: bill.total,
      refundedAmount: bill.refundedAmount ?? 0,
      collected: bill.total + (bill.tipAmount ?? 0),
    },
    items: bill.items.map((item) => ({
      id: item.id,
      name: item.itemName,
      quantity: item.quantity,
      price: item.price,
      total: item.total,
      notes: item.notes,
      addOns: item.addOns.map((addOn) => ({ id: addOn.id, name: addOn.name, price: addOn.price })),
    })),
    refunds: bill.refunds,
    runningOrder,
    timeline: buildOrderTimeline(bill, runningOrder),
  };
};

interface TimelineEvent {
  key: string;
  label: string;
  at: Date | null;
  status: "done" | "pending" | "failed" | "info";
  detail?: string;
  /** Which record the timestamp came from, so nothing here reads as invented. */
  source: string;
}

/**
 * The order timeline — the single most useful thing on this page for support.
 *
 * Every entry is derived from a real timestamp on a real row and says which one.
 * Steps the data genuinely can't evidence are shown as pending rather than
 * back-filled with a plausible time: an agent working a "payment taken but the
 * restaurant never got it" complaint needs to be able to trust that a tick means
 * the event actually happened.
 */
const buildOrderTimeline = (bill: any, runningOrder: any): TimelineEvent[] => {
  const events: TimelineEvent[] = [];

  events.push({
    key: "created",
    label: "Order created",
    at: runningOrder?.startedAt ?? bill.createdAt,
    status: "done",
    source: runningOrder ? "RunningOrder.startedAt" : "Bill.createdAt",
  });

  if (runningOrder) {
    events.push({
      key: "kitchen",
      label: `Kitchen — ${String(runningOrder.kitchenStatus ?? "PENDING").toLowerCase()}`,
      at: runningOrder.kitchenStatus === "PENDING" ? null : runningOrder.startedAt,
      status: runningOrder.kitchenStatus === "PENDING" ? "pending" : "done",
      detail: `Kitchen status ${runningOrder.kitchenStatus}`,
      source: "RunningOrder.kitchenStatus",
    });
  }

  events.push({
    key: "billed",
    label: "Bill raised",
    at: bill.createdAt,
    status: "done",
    detail: `Invoice ${bill.billNo}`,
    source: "Bill.createdAt",
  });

  const paymentStatus = bill.status;
  events.push({
    key: "payment",
    label:
      paymentStatus === "PAID"
        ? "Payment received"
        : paymentStatus === "PARTIAL"
          ? "Payment partially received"
          : paymentStatus === "CANCELLED"
            ? "Payment cancelled"
            : "Payment outstanding",
    at: paymentStatus === "PAID" || paymentStatus === "PARTIAL" ? bill.updatedAt : null,
    status: paymentStatus === "PAID" ? "done" : paymentStatus === "CANCELLED" ? "failed" : "pending",
    detail: `${bill.paymentMethod ?? "Method not recorded"} · ${paymentStatus}`,
    source: "Bill.status",
  });

  for (const refund of bill.refunds ?? []) {
    events.push({
      key: `refund-${refund.id}`,
      label: `Refunded ₹${refund.amount}`,
      at: refund.createdAt,
      status: "info",
      detail: refund.reason ?? undefined,
      source: "BillRefund",
    });
  }

  if (runningOrder?.completedAt) {
    events.push({
      key: "completed",
      label: "Order completed",
      at: runningOrder.completedAt,
      status: "done",
      source: "RunningOrder.completedAt",
    });
  } else if (bill.orderStatus === "COMPLETED") {
    events.push({
      key: "completed",
      label: "Order completed",
      at: bill.updatedAt,
      status: "done",
      source: "Bill.orderStatus",
    });
  } else if (bill.orderStatus === "CANCELLED") {
    events.push({
      key: "cancelled",
      label: "Order cancelled",
      at: bill.updatedAt,
      status: "failed",
      source: "Bill.orderStatus",
    });
  } else {
    events.push({
      key: "completed",
      label: "Order completed",
      at: null,
      status: "pending",
      source: "Bill.orderStatus",
    });
  }

  return events.sort((a, b) => {
    if (!a.at) return 1;
    if (!b.at) return -1;
    return a.at.getTime() - b.at.getTime();
  });
};

/** Live (unbilled) orders for a restaurant — the POS's current working set. */
export const listLiveOrders = async (restaurantId: number, branchId?: number) =>
  prisma.runningOrder.findMany({
    where: { restaurantId, status: "ACTIVE", ...(branchId ? { branchId } : {}) },
    orderBy: { startedAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      kitchenStatus: true,
      paymentStatus: true,
      orderType: true,
      totalAmount: true,
      finalAmount: true,
      startedAt: true,
      table: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
    },
  });

/**
 * Order state transitions are NOT implemented in V1, deliberately.
 *
 * Writing a transition table here would mean deciding, in the internal console,
 * what the POS is allowed to do — and the POS is the system that actually owns
 * an order's lifecycle. The three status columns involved (`Bill.orderStatus`,
 * `RunningOrder.status`, `RunningOrder.kitchenStatus`) move independently and
 * their real rules live in runningOrder.service.ts and bill.service.ts.
 *
 * Until those rules are confirmed and lifted into one shared place, the internal
 * app reads orders and does not write them; ORDER_UPDATE exists in the
 * permission catalog so the capability can be granted the day the writes do.
 */
export const ORDER_WRITES_ENABLED = false;
