import prisma from "../../../config/prisma";
import { PERMISSIONS } from "../rbac/permissions";
import { getActivityThresholds } from "../settings/platformSettings.service";
import { refreshRestaurantActivity } from "../restaurants/restaurantMetrics.service";

/**
 * The operations dashboard.
 *
 * Role-aware in the way that actually matters: it doesn't compute everything
 * and let the frontend hide half of it. An employee without
 * ANALYTICS_FINANCIAL_VIEW never has GMV or revenue calculated for them, so the
 * numbers are not in the response at all — and the queries behind them aren't
 * run either.
 */

export interface DashboardRange {
  from: Date;
  to: Date;
}

export const resolveRange = (query: any): DashboardRange => {
  const to = query?.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date();
  const from = query?.from
    ? new Date(query.from)
    : new Date(to.getTime() - 29 * 86_400_000);
  return { from, to };
};

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

export const getDashboard = async (permissions: Set<string>, query: any) => {
  const range = resolveRange(query);
  const canSeeMoney = permissions.has(PERMISSIONS.ANALYTICS_FINANCIAL_VIEW);
  const canSeeCustomers = permissions.has(PERMISSIONS.CUSTOMER_VIEW);
  const canSeeTickets = permissions.has(PERMISSIONS.TICKET_VIEW);

  await refreshRestaurantActivity();
  const thresholds = await getActivityThresholds();
  const todayStart = startOfToday();

  const atRiskCutoff = new Date(Date.now() - thresholds.atRiskDays * 86_400_000);

  const [accountCounts, newAccounts, atRiskAccounts, outletCount, ordersInRange, ordersToday] = await Promise.all([
    prisma.restaurant.groupBy({ by: ["platformStatus"], _count: { _all: true } }),
    prisma.restaurant.count({ where: { createdAt: { gte: range.from, lte: range.to } } }),
    // Live accounts that have stopped trading. For subscription SaaS this is
    // the leading churn indicator — an account still paying but not using the
    // product is the one about to leave.
    prisma.restaurant.count({
      where: {
        platformStatus: "ACTIVE",
        OR: [{ lastActivityAt: { lt: atRiskCutoff } }, { lastActivityAt: null }],
      },
    }),
    prisma.branch.count({ where: { isDeleted: false } }),
    prisma.bill.count({ where: { createdAt: { gte: range.from, lte: range.to }, status: { not: "CANCELLED" } } }),
    prisma.bill.count({ where: { createdAt: { gte: todayStart }, status: { not: "CANCELLED" } } }),
  ]);

  const byStatus = new Map(accountCounts.map((row) => [row.platformStatus, row._count._all]));
  const totalAccounts = accountCounts.reduce((sum, row) => sum + row._count._all, 0);
  const liveAccounts = byStatus.get("ACTIVE") ?? 0;

  /**
   * The KPIs are about DineInk's accounts, not about diners.
   *
   * An earlier version led with "total customers" and "orders today", which are
   * our restaurants' business presented as if it were ours — the console read
   * like it belonged to a restaurant rather than to the company selling to
   * them. Orders and GMV are still here, but as *value delivered through the
   * product*: how much trade our customers are putting through it, which is
   * what tells us an account is getting its money's worth.
   */
  const kpis: Record<string, unknown> = {
    totalAccounts,
    liveAccounts,
    onboardingAccounts: (byStatus.get("ONBOARDING") ?? 0) + (byStatus.get("LEAD") ?? 0),
    suspendedAccounts: byStatus.get("SUSPENDED") ?? 0,
    churnedAccounts: byStatus.get("CHURNED") ?? 0,
    newAccounts,
    atRiskAccounts,
    // A single café is one account with one outlet; a chain is one account with
    // many. Both matter — outlets are the unit of deployment.
    totalOutlets: outletCount,
    ordersToday,
    ordersInRange,
  };

  if (canSeeTickets) {
    const [openTickets, highPriorityTickets, unassignedTickets, escalatedTickets] = await Promise.all([
      prisma.supportTicket.count({ where: { status: { notIn: ["RESOLVED", "CLOSED"] } } }),
      prisma.supportTicket.count({
        where: { priority: { in: ["CRITICAL", "HIGH"] }, status: { notIn: ["RESOLVED", "CLOSED"] } },
      }),
      prisma.supportTicket.count({ where: { assignedToId: null, status: { notIn: ["RESOLVED", "CLOSED"] } } }),
      prisma.supportTicket.count({
        where: { status: { in: ["ESCALATED_TO_ENGINEERING", "ENGINEERING_RESOLVED"] } },
      }),
    ]);
    kpis.openTickets = openTickets;
    kpis.highPriorityTickets = highPriorityTickets;
    kpis.unassignedTickets = unassignedTickets;
    kpis.escalatedTickets = escalatedTickets;
  }

  if (canSeeMoney) {
    const gmvAgg = await prisma.bill.aggregate({
      where: { createdAt: { gte: range.from, lte: range.to }, status: { not: "CANCELLED" } },
      _sum: { total: true },
    });

    // GMV is our customers' trade, not our income. It's the clearest signal of
    // whether an account is getting value out of the product, so it stays —
    // but it is never labelled as DineInk revenue.
    //
    // There is deliberately no "Dine revenue" figure. DineInk sells the product
    // on subscription; it does not take a cut of what restaurants sell, and
    // there is no plan or subscription model in the schema to compute real
    // revenue from. A commission-shaped number here would have been wrong in
    // kind, not merely unset.
    kpis.gmvProcessed = gmvAgg._sum.total ?? 0;
  }

  const [alerts, charts] = await Promise.all([
    buildAlerts(permissions, thresholds),
    buildCharts(range, canSeeMoney),
  ]);

  return {
    range: { from: range.from, to: range.to },
    kpis,
    alerts,
    charts,
    capabilities: {
      financial: canSeeMoney,
      customers: canSeeCustomers,
      tickets: canSeeTickets,
    },
  };
};

export interface DashboardAlert {
  key: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  title: string;
  detail: string;
  count: number;
  href?: string;
}

/**
 * Operational alerts. Each one is a real query with a real count — an alert
 * panel that shows a category with nothing behind it trains people to ignore it.
 * Alerts an employee has no permission to act on are not returned.
 */
const buildAlerts = async (
  permissions: Set<string>,
  thresholds: { inactiveDays: number; atRiskDays: number },
): Promise<DashboardAlert[]> => {
  const alerts: DashboardAlert[] = [];
  const atRiskCutoff = new Date(Date.now() - thresholds.atRiskDays * 86_400_000);

  if (permissions.has(PERMISSIONS.TICKET_VIEW)) {
    const [critical, unassigned] = await Promise.all([
      prisma.supportTicket.count({
        where: { priority: { in: ["CRITICAL", "HIGH"] }, status: { notIn: ["RESOLVED", "CLOSED"] } },
      }),
      prisma.supportTicket.count({
        where: { assignedToId: null, status: { notIn: ["RESOLVED", "CLOSED"] } },
      }),
    ]);
    if (critical > 0) {
      alerts.push({
        key: "high-priority-tickets",
        severity: "CRITICAL",
        title: `${critical} high-priority ticket${critical === 1 ? "" : "s"} open`,
        detail: "Critical and high-priority support tickets that aren't resolved yet.",
        count: critical,
        href: "/support-tickets?priority=CRITICAL,HIGH&status=open",
      });
    }
    if (unassigned > 0) {
      alerts.push({
        key: "unassigned-tickets",
        severity: "WARNING",
        title: `${unassigned} ticket${unassigned === 1 ? "" : "s"} unassigned`,
        detail: "Nobody is currently working these.",
        count: unassigned,
        href: "/support-tickets?assigned=none",
      });
    }
  }

  if (permissions.has(PERMISSIONS.RESTAURANT_VIEW)) {
    const [inactive, stalledOnboarding] = await Promise.all([
      prisma.restaurant.count({
        where: {
          platformStatus: "ACTIVE",
          OR: [{ lastActivityAt: { lt: atRiskCutoff } }, { lastActivityAt: null }],
        },
      }),
      prisma.restaurant.count({
        where: {
          platformStatus: { in: ["LEAD", "ONBOARDING"] },
          createdAt: { lt: new Date(Date.now() - 14 * 86_400_000) },
        },
      }),
    ]);
    if (inactive > 0) {
      alerts.push({
        key: "inactive-restaurants",
        severity: "WARNING",
        title: `${inactive} live restaurant${inactive === 1 ? "" : "s"} not trading`,
        detail: `No orders in the last ${thresholds.atRiskDays} days.`,
        count: inactive,
        href: "/restaurants?activity=INACTIVE&status=ACTIVE",
      });
    }
    if (stalledOnboarding > 0) {
      alerts.push({
        key: "stalled-onboarding",
        severity: "INFO",
        title: `${stalledOnboarding} restaurant${stalledOnboarding === 1 ? "" : "s"} onboarding over 2 weeks`,
        detail: "Created more than 14 days ago and still not live.",
        count: stalledOnboarding,
        href: "/restaurant-onboarding",
      });
    }
  }

  if (permissions.has(PERMISSIONS.TRANSACTION_VIEW)) {
    const failedToday = await prisma.bill.count({
      where: { createdAt: { gte: startOfToday() }, status: "CANCELLED" },
    });
    if (failedToday > 0) {
      alerts.push({
        key: "cancelled-payments",
        severity: "WARNING",
        title: `${failedToday} payment${failedToday === 1 ? "" : "s"} cancelled today`,
        detail: "Bills cancelled after being raised.",
        count: failedToday,
        href: "/transactions?status=CANCELLED",
      });
    }
  }

  return alerts;
};

/**
 * Time series for the dashboard charts.
 *
 * Bucketed in SQL rather than by pulling every row into Node and grouping it
 * there — a month of orders across every restaurant is a lot of rows to move
 * just to count them by day.
 */
const buildCharts = async (range: DashboardRange, includeMoney: boolean) => {
  const [ordersOverTime, restaurantGrowth, customerGrowth] = await Promise.all([
    prisma.$queryRaw<{ day: Date; orders: bigint; gmv: number | null }[]>`
      SELECT date_trunc('day', "createdAt") AS day,
             COUNT(*) AS orders,
             SUM("total") AS gmv
      FROM "Bill"
      WHERE "createdAt" >= ${range.from} AND "createdAt" <= ${range.to} AND "status" <> 'CANCELLED'
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.$queryRaw<{ day: Date; count: bigint }[]>`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*) AS count
      FROM "Restaurant"
      WHERE "createdAt" >= ${range.from} AND "createdAt" <= ${range.to}
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.$queryRaw<{ day: Date; count: bigint }[]>`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*) AS count
      FROM "Customer"
      WHERE "createdAt" >= ${range.from} AND "createdAt" <= ${range.to}
      GROUP BY 1
      ORDER BY 1
    `,
  ]);

  return {
    // COUNT() comes back as a bigint, which JSON.stringify refuses to
    // serialize — converted here rather than at every call site.
    ordersOverTime: ordersOverTime.map((row) => ({
      date: row.day,
      orders: Number(row.orders),
      ...(includeMoney ? { gmv: row.gmv ?? 0 } : {}),
    })),
    restaurantGrowth: restaurantGrowth.map((row) => ({ date: row.day, count: Number(row.count) })),
    customerGrowth: customerGrowth.map((row) => ({ date: row.day, count: Number(row.count) })),
  };
};
