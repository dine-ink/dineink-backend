import prisma from "../../../config/prisma";
import { notFound } from "../shared/apiError";
import { parsePage, parseSort, toPaged } from "../shared/pagination";
import { applyContactMasking } from "../shared/pii";

/**
 * Customers.
 *
 * Two things about the existing data model shape everything here:
 *
 *  1. A Customer row is **scoped to one restaurant** — the unique key is
 *     (restaurantId, phone), because the same phone number can be a genuine
 *     customer at two independent restaurants. So there is no single global
 *     "customer" to open; there are per-restaurant records.
 *
 *  2. Contact details are masked on the way out unless the caller holds
 *     CUSTOMER_PII_VIEW, and revealing them is itself an audited event. Least
 *     privilege here isn't decoration: a support agent needs to confirm a
 *     number matches, not to be able to export the book.
 */

const CUSTOMER_SORT_FIELDS = ["createdAt", "name"] as const;

export interface CustomerListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  restaurantId?: number;
  sortBy?: string;
  sortDir?: string;
}

export const listCustomers = async (query: CustomerListQuery, canViewPii: boolean) => {
  const page = parsePage(query);
  const sort = parseSort(query, CUSTOMER_SORT_FIELDS, "createdAt");

  const filters: any[] = [];
  if (query.restaurantId) filters.push({ restaurantId: Number(query.restaurantId) });

  if (query.search?.trim()) {
    const term = query.search.trim();
    const idMatch = term.match(/^(?:cust(?:omer)?-)?(\d+)$/i);
    const or: any[] = [
      { name: { contains: term, mode: "insensitive" } },
      // Phone is matched even by an employee who can't see it unmasked: being
      // able to *find* the record you were given a number for is the job, and
      // the result still comes back masked.
      { phone: { contains: term } },
      { email: { contains: term, mode: "insensitive" } },
    ];
    if (idMatch) or.push({ id: Number(idMatch[1]) });

    // Searching by order id resolves through the bill to its customer.
    const orderMatch = term.match(/^(?:ord-|txn-)?(\d+)$/i);
    if (orderMatch) or.push({ bills: { some: { id: Number(orderMatch[1]) } } });
    or.push({ bills: { some: { billNo: { contains: term, mode: "insensitive" } } } });

    filters.push({ OR: or });
  }

  const where = filters.length ? { AND: filters } : {};

  const [rows, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { [sort.field]: sort.direction },
      skip: page.skip,
      take: page.take,
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        createdAt: true,
        restaurant: { select: { id: true, name: true } },
      },
    }),
    prisma.customer.count({ where }),
  ]);

  // One grouped aggregate for the page rather than a query per customer.
  const ids = rows.map((r) => r.id);
  const grouped = ids.length
    ? await prisma.bill.groupBy({
        by: ["customerId"],
        where: { customerId: { in: ids }, status: { not: "CANCELLED" } },
        _count: { _all: true },
        _sum: { total: true },
        _max: { createdAt: true },
      })
    : [];
  const aggregates = new Map(grouped.map((g) => [g.customerId, g]));

  const mapped = rows.map((row) => {
    const agg = aggregates.get(row.id);
    return {
      ...applyContactMasking(row, canViewPii),
      displayId: `CUST-${row.id}`,
      registeredAt: row.createdAt,
      totalOrders: agg?._count._all ?? 0,
      totalSpend: agg?._sum.total ?? 0,
      lastActivityAt: agg?._max.createdAt ?? null,
      // A customer row has no status column of its own; "active" is a statement
      // about recent trading, so it's derived rather than read from a field
      // that doesn't exist.
      status: agg?._max.createdAt && Date.now() - agg._max.createdAt.getTime() < 90 * 86_400_000
        ? "ACTIVE"
        : agg?._count._all
          ? "DORMANT"
          : "NEW",
    };
  });

  return toPaged(mapped, total, page);
};

export const getCustomer = async (customerId: number, canViewPii: boolean) => {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { restaurant: { select: { id: true, name: true, city: true } } },
  });
  if (!customer) throw notFound("Customer not found", "CUSTOMER_NOT_FOUND");

  const [billStats, openTickets] = await Promise.all([
    prisma.bill.aggregate({
      where: { customerId, status: { not: "CANCELLED" } },
      _count: { _all: true },
      _sum: { total: true, refundedAmount: true },
      _max: { createdAt: true },
      _min: { createdAt: true },
    }),
    prisma.supportTicket.count({
      where: { customerId, status: { notIn: ["RESOLVED", "CLOSED"] } },
    }),
  ]);

  const orders = billStats._count._all;
  const spend = billStats._sum.total ?? 0;

  return {
    ...applyContactMasking(customer, canViewPii),
    displayId: `CUST-${customer.id}`,
    restaurant: customer.restaurant,
    registeredAt: customer.createdAt,
    metrics: {
      totalOrders: orders,
      totalSpend: spend,
      averageOrderValue: orders > 0 ? spend / orders : 0,
      totalRefunded: billStats._sum.refundedAmount ?? 0,
      firstOrderAt: billStats._min.createdAt,
      lastActivityAt: billStats._max.createdAt,
      openTickets,
    },
  };
};

export const listCustomerOrders = async (customerId: number, query: any) => {
  const page = parsePage(query);
  const [rows, total] = await Promise.all([
    prisma.bill.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      skip: page.skip,
      take: page.take,
      select: {
        id: true,
        billNo: true,
        total: true,
        status: true,
        orderStatus: true,
        paymentMethod: true,
        createdAt: true,
        restaurant: { select: { id: true, name: true } },
      },
    }),
    prisma.bill.count({ where: { customerId } }),
  ]);

  return toPaged(
    rows.map((row) => ({
      id: row.id,
      displayId: `ORD-${row.id}`,
      billNo: row.billNo,
      amount: row.total,
      paymentStatus: row.status,
      orderStatus: row.orderStatus,
      paymentMethod: row.paymentMethod,
      createdAt: row.createdAt,
      restaurant: row.restaurant,
    })),
    total,
    page,
  );
};

/**
 * Other restaurants this person has records at, matched on phone number.
 *
 * Gated behind CUSTOMER_PII_VIEW by the route, because correlating one
 * restaurant's customer with another's is exactly the kind of cross-tenant
 * identity linking that the per-restaurant Customer scoping exists to avoid
 * doing casually. The restaurants are named; the other records' contact details
 * are not returned.
 */
export const listRestaurantsVisited = async (customerId: number) => {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, phone: true },
  });
  if (!customer) throw notFound("Customer not found", "CUSTOMER_NOT_FOUND");

  const linked = await prisma.customer.findMany({
    where: { phone: customer.phone },
    select: {
      id: true,
      restaurantId: true,
      createdAt: true,
      restaurant: { select: { id: true, name: true, city: true } },
    },
  });

  const stats = await prisma.bill.groupBy({
    by: ["customerId"],
    where: { customerId: { in: linked.map((l) => l.id) }, status: { not: "CANCELLED" } },
    _count: { _all: true },
    _sum: { total: true },
    _max: { createdAt: true },
  });
  const byCustomer = new Map(stats.map((s) => [s.customerId, s]));

  return linked.map((link) => {
    const stat = byCustomer.get(link.id);
    return {
      customerId: link.id,
      isCurrent: link.id === customerId,
      restaurant: link.restaurant,
      firstSeenAt: link.createdAt,
      orders: stat?._count._all ?? 0,
      spend: stat?._sum.total ?? 0,
      lastOrderAt: stat?._max.createdAt ?? null,
    };
  });
};

export const listCustomerTickets = (customerId: number) =>
  prisma.supportTicket.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      ticketNo: true,
      title: true,
      category: true,
      priority: true,
      status: true,
      createdAt: true,
      assignedTo: { select: { id: true, name: true } },
    },
  });
