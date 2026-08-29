import prisma from "../../../config/prisma";
import { notFound } from "../shared/apiError";
import { parsePage, parseSort, toPaged } from "../shared/pagination";
import { applyContactMasking } from "../shared/pii";

/**
 * Transactions.
 *
 * IMPORTANT — what this is built on, and what it deliberately does not invent.
 *
 * DineInk's backend has no payment-gateway integration and no transaction
 * table: a payment is recorded as fields on the Bill it settles
 * (`paymentMethod`, `status`) plus the BillRefund ledger. So a "transaction"
 * here is a *projection* over those rows, not a new entity and not a second
 * copy of the money.
 *
 * That has one consequence worth being explicit about: the gateway columns the
 * brief lists — gateway name, gateway reference, INITIATED/PROCESSING
 * timestamps — have no source data. They are returned as null and rendered as
 * "—", because a plausible-looking fabricated gateway reference on a payments
 * screen is worse than an obvious blank: someone would eventually quote one to
 * a payment provider. When a real gateway is integrated, this module is where
 * those fields get filled in, and every consumer already handles null.
 */

export type TransactionStatus =
  | "INITIATED"
  | "PROCESSING"
  | "SUCCESS"
  | "FAILED"
  | "CANCELLED"
  | "REFUND_PENDING"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED";

/**
 * Maps the Bill's payment state and refund ledger onto the transaction
 * vocabulary. Refund state takes precedence over payment state, because a fully
 * refunded payment is more usefully described as REFUNDED than as SUCCESS.
 */
export const deriveTransactionStatus = (bill: {
  status: string;
  total: number;
  refundedAmount?: number | null;
}): TransactionStatus => {
  const refunded = bill.refundedAmount ?? 0;

  if (refunded > 0) {
    // `Bill.total` is reduced by each refund, so the original charge is
    // total + refunded — comparing against `total` alone would mark every
    // partial refund as full.
    const originalCharge = bill.total + refunded;
    return refunded >= originalCharge - 0.005 ? "REFUNDED" : "PARTIALLY_REFUNDED";
  }

  switch (bill.status) {
    case "PAID":
      return "SUCCESS";
    case "PARTIAL":
      return "PROCESSING";
    case "CANCELLED":
      return "CANCELLED";
    case "UNPAID":
    default:
      return "INITIATED";
  }
};

const TRANSACTION_SORT_FIELDS = ["createdAt", "updatedAt", "total"] as const;

export interface TransactionListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  restaurantId?: number;
  /** One outlet of a multi-branch account. */
  branchId?: number;
  customerId?: number;
  status?: string;
  paymentMethod?: string;
  from?: string;
  to?: string;
  minAmount?: number;
  maxAmount?: number;
  sortBy?: string;
  sortDir?: string;
}

/**
 * Status is filtered by translating the requested transaction status back into
 * the Bill conditions that produce it, so filtering still happens in the
 * database. Filtering a page of results in memory would silently return fewer
 * rows than the page size and break the totals.
 */
const statusToBillWhere = (status: string): any | null => {
  switch (status) {
    case "SUCCESS":
      return { status: "PAID", OR: [{ refundedAmount: null }, { refundedAmount: { lte: 0 } }] };
    case "PROCESSING":
      return { status: "PARTIAL", OR: [{ refundedAmount: null }, { refundedAmount: { lte: 0 } }] };
    case "CANCELLED":
      return { status: "CANCELLED", OR: [{ refundedAmount: null }, { refundedAmount: { lte: 0 } }] };
    case "INITIATED":
      return { status: "UNPAID", OR: [{ refundedAmount: null }, { refundedAmount: { lte: 0 } }] };
    case "REFUNDED":
    case "PARTIALLY_REFUNDED":
      // Both are "has refunds"; the exact split depends on comparing two
      // columns, which Prisma can't express in a filter. The rows are narrowed
      // here and the precise bucket is applied below.
      return { refundedAmount: { gt: 0 } };
    default:
      return null;
  }
};

export const listTransactions = async (query: TransactionListQuery, canViewPii: boolean) => {
  const page = parsePage(query);
  const sort = parseSort(query, TRANSACTION_SORT_FIELDS, "createdAt");

  const filters: any[] = [];
  if (query.search?.trim()) {
    const term = query.search.trim();
    const idMatch = term.match(/^(?:txn-|ord-)?(\d+)$/i);
    const or: any[] = [{ billNo: { contains: term, mode: "insensitive" } }];
    if (idMatch) or.push({ id: Number(idMatch[1]) });
    filters.push({ OR: or });
  }
  if (query.restaurantId) filters.push({ restaurantId: Number(query.restaurantId) });
  if (query.branchId) filters.push({ branchId: Number(query.branchId) });
  if (query.customerId) filters.push({ customerId: Number(query.customerId) });
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
  if (query.status) {
    const statusWhere = statusToBillWhere(query.status);
    if (statusWhere) filters.push(statusWhere);
  }

  const where = filters.length ? { AND: filters } : {};

  const [rows, total] = await Promise.all([
    prisma.bill.findMany({
      where,
      orderBy: { [sort.field]: sort.direction },
      skip: page.skip,
      take: page.take,
      select: {
        id: true,
        billNo: true,
        status: true,
        total: true,
        tipAmount: true,
        refundedAmount: true,
        paymentMethod: true,
        createdAt: true,
        updatedAt: true,
        restaurant: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true, phone: true } },
      },
    }),
    prisma.bill.count({ where }),
  ]);

  let mapped = rows.map((row) => ({
    id: row.id,
    displayId: `TXN-${row.id}`,
    orderId: row.id,
    orderDisplayId: `ORD-${row.id}`,
    billNo: row.billNo,
    amount: row.total + (row.tipAmount ?? 0),
    refundedAmount: row.refundedAmount ?? 0,
    paymentMethod: row.paymentMethod,
    status: deriveTransactionStatus(row),
    // No gateway integration exists — see the module comment. Null, not a
    // placeholder string, so the UI can render "—" and nothing downstream
    // mistakes it for a real reference.
    gateway: null as string | null,
    gatewayReference: null as string | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    restaurant: row.restaurant,
    customer: row.customer ? applyContactMasking(row.customer, canViewPii) : null,
  }));

  // Split the "has refunds" bucket into the precise status the caller asked for.
  if (query.status === "REFUNDED" || query.status === "PARTIALLY_REFUNDED") {
    mapped = mapped.filter((t) => t.status === query.status);
  }

  return toPaged(mapped, total, page);
};

export const getTransaction = async (transactionId: number, canViewPii: boolean) => {
  const bill = await prisma.bill.findUnique({
    where: { id: transactionId },
    include: {
      restaurant: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true, phone: true, email: true } },
      refunds: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!bill) throw notFound("Transaction not found", "TRANSACTION_NOT_FOUND");

  const refunded = bill.refundedAmount ?? 0;

  return {
    id: bill.id,
    displayId: `TXN-${bill.id}`,
    orderId: bill.id,
    orderDisplayId: `ORD-${bill.id}`,
    billNo: bill.billNo,
    status: deriveTransactionStatus(bill),
    paymentMethod: bill.paymentMethod,
    gateway: null,
    gatewayReference: null,
    amounts: {
      charged: bill.total + refunded + (bill.tipAmount ?? 0),
      net: bill.total + (bill.tipAmount ?? 0),
      tip: bill.tipAmount ?? 0,
      refunded,
      refundable: Math.max(0, bill.total),
    },
    createdAt: bill.createdAt,
    updatedAt: bill.updatedAt,
    restaurant: bill.restaurant,
    branch: bill.branch,
    customer: bill.customer ? applyContactMasking(bill.customer, canViewPii) : null,
    refunds: bill.refunds,
    timeline: [
      { key: "initiated", label: "Payment initiated", at: bill.createdAt, source: "Bill.createdAt" },
      {
        key: "settled",
        label:
          bill.status === "PAID"
            ? "Payment successful"
            : bill.status === "CANCELLED"
              ? "Payment cancelled"
              : bill.status === "PARTIAL"
                ? "Partially paid"
                : "Awaiting payment",
        at: bill.status === "UNPAID" ? null : bill.updatedAt,
        source: "Bill.status",
      },
      ...bill.refunds.map((refund) => ({
        key: `refund-${refund.id}`,
        label: `Refunded ₹${refund.amount}`,
        at: refund.createdAt,
        source: "BillRefund",
      })),
    ],
  };
};

/** The distinct payment methods actually in use, for the filter menu. */
export const getPaymentMethods = async () => {
  const rows = await prisma.bill.findMany({
    distinct: ["paymentMethod"],
    select: { paymentMethod: true },
    take: 50,
  });
  return rows.map((r) => r.paymentMethod).filter(Boolean).sort();
};
