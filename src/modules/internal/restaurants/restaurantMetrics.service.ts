import prisma from "../../../config/prisma";

/**
 * Order/revenue aggregates for restaurants, computed from the existing Bill
 * ledger rather than from any new table.
 *
 * A Bill is DineInk's record of a completed, billed order — it carries the
 * total, the payment method, the payment status and the refund ledger — so
 * every "orders" and "revenue" figure the internal console shows is derived
 * from the same rows the restaurant's own reports use. There is deliberately no
 * parallel orders/revenue store for the internal app to drift away from.
 *
 * Cancelled bills are excluded from both counts and totals: an order that was
 * voided is not an order the restaurant served, and including it would inflate
 * every restaurant's numbers against what its own dashboard shows.
 */

export interface RestaurantAggregate {
  restaurantId: number;
  orders: number;
  revenue: number;
  lastOrderAt: Date | null;
}

const EXCLUDED_BILL_STATUSES = ["CANCELLED"] as const;

export const aggregateByRestaurant = async (
  restaurantIds: number[],
  range?: { from?: Date; to?: Date },
): Promise<Map<number, RestaurantAggregate>> => {
  const result = new Map<number, RestaurantAggregate>();
  if (!restaurantIds.length) return result;

  const where: any = {
    restaurantId: { in: restaurantIds },
    status: { notIn: EXCLUDED_BILL_STATUSES as unknown as string[] },
  };
  if (range?.from || range?.to) {
    where.createdAt = {};
    if (range.from) where.createdAt.gte = range.from;
    if (range.to) where.createdAt.lte = range.to;
  }

  const grouped = await prisma.bill.groupBy({
    by: ["restaurantId"],
    where,
    _count: { _all: true },
    _sum: { total: true },
    _max: { createdAt: true },
  });

  for (const id of restaurantIds) {
    result.set(id, { restaurantId: id, orders: 0, revenue: 0, lastOrderAt: null });
  }
  for (const row of grouped) {
    result.set(row.restaurantId, {
      restaurantId: row.restaurantId,
      orders: row._count._all,
      revenue: row._sum.total ?? 0,
      lastOrderAt: row._max.createdAt ?? null,
    });
  }
  return result;
};

export interface RestaurantKpis {
  orders: number;
  revenue: number;
  customers: number;
  averageOrderValue: number;
  refundedAmount: number;
  lastOrderAt: Date | null;
}

export const restaurantKpis = async (
  restaurantId: number,
  range?: { from?: Date; to?: Date },
): Promise<RestaurantKpis> => {
  const billWhere: any = {
    restaurantId,
    status: { notIn: EXCLUDED_BILL_STATUSES as unknown as string[] },
  };
  if (range?.from || range?.to) {
    billWhere.createdAt = {};
    if (range.from) billWhere.createdAt.gte = range.from;
    if (range.to) billWhere.createdAt.lte = range.to;
  }

  const [bills, customers] = await Promise.all([
    prisma.bill.aggregate({
      where: billWhere,
      _count: { _all: true },
      _sum: { total: true, refundedAmount: true },
      _max: { createdAt: true },
    }),
    prisma.customer.count({ where: { restaurantId } }),
  ]);

  const orders = bills._count._all;
  const revenue = bills._sum.total ?? 0;

  return {
    orders,
    revenue,
    customers,
    // Guarded rather than allowed to produce NaN — a restaurant with no orders
    // yet is the normal state during onboarding, not an error.
    averageOrderValue: orders > 0 ? revenue / orders : 0,
    refundedAmount: bills._sum.refundedAmount ?? 0,
    lastOrderAt: bills._max.createdAt ?? null,
  };
};

/**
 * Refreshes Restaurant.lastActivityAt from the Bill ledger in one statement.
 *
 * The column exists so activity can be *filtered and sorted in the database* —
 * deriving it per request would mean either aggregating every restaurant on
 * every page load, or filtering after pagination, which silently returns the
 * wrong rows. Nothing in the restaurant-facing apps writes it, so the internal
 * app keeps it current itself.
 *
 * Throttled in-process: a burst of dashboard requests triggers at most one
 * refresh every few minutes, and each instance refreshing independently is
 * harmless because the statement is idempotent.
 */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
let lastRefreshAt = 0;
let inFlight: Promise<void> | null = null;

export const refreshRestaurantActivity = async (force = false): Promise<void> => {
  if (!force && Date.now() - lastRefreshAt < REFRESH_INTERVAL_MS) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      await prisma.$executeRaw`
        UPDATE "Restaurant" r
        SET "lastActivityAt" = latest.last_at
        FROM (
          SELECT "restaurantId", MAX("createdAt") AS last_at
          FROM "Bill"
          WHERE "status" <> 'CANCELLED'
          GROUP BY "restaurantId"
        ) latest
        WHERE latest."restaurantId" = r.id
          AND r."lastActivityAt" IS DISTINCT FROM latest.last_at
      `;
      lastRefreshAt = Date.now();
    } catch (error) {
      // A stale activity column degrades a filter; a failed page load is worse.
      console.error("[internal] restaurant activity refresh failed", error);
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
};
