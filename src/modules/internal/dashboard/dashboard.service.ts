import prisma from "../../../config/prisma";
import { PERMISSIONS } from "../rbac/permissions";
import { accountWhere, relatedAccountWhere } from "../rbac/scope";

/**
 * The operations dashboard.
 *
 * Rewritten around the commercial model. It previously counted restaurants and
 * their order volume, which described our customers' trade rather than our
 * business, and flagged accounts "at risk" for not having taken an order —
 * a marketplace's churn signal, not a software vendor's.
 *
 * What it reports now is what DineInk actually needs to know each morning: how
 * many customers there are, what they are subscribed to, who is mid-onboarding,
 * what is unpaid, and what support is carrying.
 *
 * Role-aware in the way that matters: it doesn't compute everything and let the
 * frontend hide half of it. An employee without ANALYTICS_FINANCIAL_VIEW never
 * has revenue calculated for them — the queries behind those numbers are not
 * run at all. Every count is also account-scoped, so an assigned-only employee
 * sees a dashboard for their own book rather than for the whole company.
 */

export interface DashboardRange {
  from: Date;
  to: Date;
}

export const resolveRange = (query: any): DashboardRange => {
  const to = query?.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date();
  const from = query?.from ? new Date(query.from) : new Date(to.getTime() - 29 * 86_400_000);
  return { from, to };
};

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

/** Renewals inside this window are "coming up". A display horizon, not a rule. */
const RENEWAL_HORIZON_DAYS = 30;

export const getDashboard = async (req: any, permissions: Set<string>, query: any) => {
  const range = resolveRange(query);
  const canSeeMoney = permissions.has(PERMISSIONS.ANALYTICS_FINANCIAL_VIEW);
  const canSeeTickets = permissions.has(PERMISSIONS.TICKET_VIEW);
  const canSeeBilling = permissions.has(PERMISSIONS.INVOICE_VIEW);
  const canSeeSubscriptions = permissions.has(PERMISSIONS.SUBSCRIPTION_VIEW);
  const canSeeOnboarding = permissions.has(PERMISSIONS.ONBOARDING_VIEW);

  const scopedAccounts = accountWhere(req);
  const scopedByAccount = relatedAccountWhere(req);

  const [accountCounts, newAccounts, outletCount] = await Promise.all([
    prisma.account.groupBy({ by: ["status"], where: scopedAccounts, _count: { _all: true } }),
    prisma.account.count({
      where: { ...scopedAccounts, createdAt: { gte: range.from, lte: range.to } },
    }),
    prisma.branch.count({
      where: {
        isDeleted: false,
        operationalStatus: "ACTIVE",
        ...(Object.keys(scopedAccounts).length ? { restaurant: { account: scopedAccounts } } : {}),
      },
    }),
  ]);

  const byStatus = new Map(accountCounts.map((row) => [row.status, row._count._all]));
  const totalAccounts = accountCounts.reduce((sum, row) => sum + row._count._all, 0);

  const kpis: Record<string, unknown> = {
    totalAccounts,
    customers: byStatus.get("CUSTOMER") ?? 0,
    leads: byStatus.get("LEAD") ?? 0,
    prospects: byStatus.get("PROSPECT") ?? 0,
    churned: byStatus.get("CHURNED") ?? 0,
    newAccounts,
    // A single cafe is one customer with one outlet; a chain is one customer
    // with many. Outlets are the unit of deployment, not of billing.
    totalOutlets: outletCount,
  };

  if (canSeeSubscriptions) {
    const [subscriptionCounts, renewalsDue] = await Promise.all([
      prisma.subscription.groupBy({
        by: ["status"],
        where: scopedByAccount,
        _count: { _all: true },
      }),
      prisma.subscription.count({
        where: {
          ...scopedByAccount,
          status: { in: ["ACTIVE", "TRIAL"] },
          renewalDate: {
            gte: new Date(),
            lte: new Date(Date.now() + RENEWAL_HORIZON_DAYS * 86_400_000),
          },
        },
      }),
    ]);
    const subsByStatus = new Map(subscriptionCounts.map((row) => [row.status, row._count._all]));
    kpis.activeSubscriptions = subsByStatus.get("ACTIVE") ?? 0;
    kpis.trialSubscriptions = subsByStatus.get("TRIAL") ?? 0;
    kpis.pastDueSubscriptions = subsByStatus.get("PAST_DUE") ?? 0;
    kpis.pausedSubscriptions = subsByStatus.get("PAUSED") ?? 0;
    kpis.cancelledSubscriptions = subsByStatus.get("CANCELLED") ?? 0;
    kpis.renewalsDue = renewalsDue;
  }

  if (canSeeOnboarding) {
    const onboardingCounts = await prisma.onboarding.groupBy({
      by: ["status"],
      where: scopedByAccount,
      _count: { _all: true },
    });
    const byOnboarding = new Map(onboardingCounts.map((row) => [row.status, row._count._all]));
    kpis.onboardingInProgress = byOnboarding.get("IN_PROGRESS") ?? 0;
    kpis.onboardingBlocked = byOnboarding.get("BLOCKED") ?? 0;
    kpis.onboardingReadyForGoLive = byOnboarding.get("READY_FOR_GO_LIVE") ?? 0;
  }

  if (canSeeTickets) {
    const ticketWhere = ticketScope(req);
    const [openTickets, highPriorityTickets, unassignedTickets, escalatedTickets] = await Promise.all([
      prisma.supportTicket.count({ where: { ...ticketWhere, status: { notIn: ["RESOLVED", "CLOSED"] } } }),
      prisma.supportTicket.count({
        where: { ...ticketWhere, priority: { in: ["CRITICAL", "HIGH"] }, status: { notIn: ["RESOLVED", "CLOSED"] } },
      }),
      prisma.supportTicket.count({
        where: { ...ticketWhere, assignedToId: null, status: { notIn: ["RESOLVED", "CLOSED"] } },
      }),
      prisma.supportTicket.count({
        where: { ...ticketWhere, status: { in: ["ESCALATED_TO_ENGINEERING", "ENGINEERING_RESOLVED"] } },
      }),
    ]);
    kpis.openTickets = openTickets;
    kpis.highPriorityTickets = highPriorityTickets;
    kpis.unassignedTickets = unassignedTickets;
    kpis.escalatedTickets = escalatedTickets;
  }

  if (canSeeBilling) {
    const [outstanding, overdueCount] = await Promise.all([
      prisma.invoice.aggregate({
        where: { ...scopedByAccount, status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } },
        _sum: { total: true, amountPaid: true },
        _count: { _all: true },
      }),
      prisma.invoice.count({
        where: {
          ...scopedByAccount,
          status: { in: ["ISSUED", "PARTIALLY_PAID"] },
          dueDate: { lt: new Date() },
        },
      }),
    ]);
    kpis.openInvoices = outstanding._count._all;
    kpis.overdueInvoices = overdueCount;
    // Outstanding is only meaningful to someone allowed to see money. Without
    // the financial grant the count of open invoices is still useful, the
    // amount is not shown.
    if (canSeeMoney) {
      const billed = Number(outstanding._sum.total ?? 0);
      const paid = Number(outstanding._sum.amountPaid ?? 0);
      kpis.outstandingAmount = Math.max(0, billed - paid);
    }
  }

  const [alerts, charts] = await Promise.all([
    buildAlerts(req, permissions),
    buildCharts(req, range),
  ]);

  return {
    range,
    capabilities: {
      financial: canSeeMoney,
      tickets: canSeeTickets,
      billing: canSeeBilling,
      subscriptions: canSeeSubscriptions,
      onboarding: canSeeOnboarding,
    },
    kpis,
    alerts,
    charts,
  };
};

/**
 * Ticket scoping.
 *
 * A ticket reaches an account through `accountId`. Tickets raised before the
 * commercial model existed, or about something that isn't account-specific,
 * have none — those stay visible to global-scope callers and are hidden from
 * assigned-only ones, which is the safe direction.
 */
const ticketScope = (req: any): Record<string, unknown> => {
  const scoped = relatedAccountWhere(req);
  return Object.keys(scoped).length ? scoped : {};
};

/**
 * The things worth interrupting someone about.
 *
 * Every alert is a queue with a name and a link. Nothing here is an inferred
 * risk score — each one is a concrete state a person can act on: a blocked
 * onboarding, an overdue invoice, an unassigned ticket.
 */
const buildAlerts = async (req: any, permissions: Set<string>) => {
  const alerts: {
    key: string;
    severity: "CRITICAL" | "WARNING" | "INFO";
    title: string;
    detail: string;
    count: number;
    href: string;
  }[] = [];

  const scopedByAccount = relatedAccountWhere(req);

  if (permissions.has(PERMISSIONS.TICKET_VIEW)) {
    const ticketWhere = ticketScope(req);
    const [critical, unassigned] = await Promise.all([
      prisma.supportTicket.count({
        where: { ...ticketWhere, priority: { in: ["CRITICAL", "HIGH"] }, status: { notIn: ["RESOLVED", "CLOSED"] } },
      }),
      prisma.supportTicket.count({
        where: { ...ticketWhere, assignedToId: null, status: { notIn: ["RESOLVED", "CLOSED"] } },
      }),
    ]);
    if (critical > 0) {
      alerts.push({
        key: "high-priority-tickets",
        severity: "CRITICAL",
        title: `${critical} high-priority ticket${critical === 1 ? "" : "s"} open`,
        detail: "Critical and high-priority support tickets that aren't resolved yet.",
        count: critical,
        href: "/support/tickets?priority=CRITICAL,HIGH&status=open",
      });
    }
    if (unassigned > 0) {
      alerts.push({
        key: "unassigned-tickets",
        severity: "WARNING",
        title: `${unassigned} ticket${unassigned === 1 ? "" : "s"} unassigned`,
        detail: "Nobody is currently working these.",
        count: unassigned,
        href: "/support/tickets?assigned=none",
      });
    }
  }

  if (permissions.has(PERMISSIONS.ONBOARDING_VIEW)) {
    const [blocked, readyForGoLive] = await Promise.all([
      prisma.onboarding.count({ where: { ...scopedByAccount, status: "BLOCKED" } }),
      prisma.onboarding.count({ where: { ...scopedByAccount, status: "READY_FOR_GO_LIVE" } }),
    ]);
    if (blocked > 0) {
      alerts.push({
        key: "blocked-onboarding",
        severity: "WARNING",
        title: `${blocked} onboarding${blocked === 1 ? "" : "s"} blocked`,
        detail: "Waiting on something before they can progress.",
        count: blocked,
        href: "/onboarding?status=BLOCKED",
      });
    }
    if (readyForGoLive > 0) {
      alerts.push({
        key: "ready-for-go-live",
        severity: "INFO",
        title: `${readyForGoLive} customer${readyForGoLive === 1 ? "" : "s"} ready to go live`,
        detail: "Every mandatory onboarding step is complete.",
        count: readyForGoLive,
        href: "/onboarding?status=READY_FOR_GO_LIVE",
      });
    }
  }

  if (permissions.has(PERMISSIONS.SUBSCRIPTION_VIEW)) {
    const [pastDue, expiringTrials] = await Promise.all([
      prisma.subscription.count({ where: { ...scopedByAccount, status: "PAST_DUE" } }),
      prisma.subscription.count({
        where: {
          ...scopedByAccount,
          status: "TRIAL",
          trialEndsAt: { gte: new Date(), lte: new Date(Date.now() + 7 * 86_400_000) },
        },
      }),
    ]);
    if (pastDue > 0) {
      alerts.push({
        key: "past-due-subscriptions",
        severity: "CRITICAL",
        title: `${pastDue} subscription${pastDue === 1 ? "" : "s"} past due`,
        detail: "Payment is outstanding on these.",
        count: pastDue,
        href: "/commercial/subscriptions?status=PAST_DUE",
      });
    }
    if (expiringTrials > 0) {
      alerts.push({
        key: "expiring-trials",
        severity: "WARNING",
        title: `${expiringTrials} trial${expiringTrials === 1 ? "" : "s"} ending within a week`,
        detail: "Convert or extend before they lapse.",
        count: expiringTrials,
        href: "/commercial/subscriptions?status=TRIAL",
      });
    }
  }

  if (permissions.has(PERMISSIONS.INVOICE_VIEW)) {
    const overdue = await prisma.invoice.count({
      where: { ...scopedByAccount, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: new Date() } },
    });
    if (overdue > 0) {
      alerts.push({
        key: "overdue-invoices",
        severity: "WARNING",
        title: `${overdue} invoice${overdue === 1 ? "" : "s"} overdue`,
        detail: "Issued, past their due date and not fully paid.",
        count: overdue,
        href: "/commercial/billing?status=OVERDUE",
      });
    }
  }

  return alerts;
};

/**
 * Charts.
 *
 * Customer growth is cumulative — the size of the book over time. It reads as
 * a daily intake only if you feed it the day's sign-ups, which drew a falling
 * line whenever a quiet day followed a busy one and looked like customers
 * leaving. They never do that silently; churn is a lifecycle change.
 */
const buildCharts = async (req: any, range: DashboardRange) => {
  const accountIds = await scopedAccountIdList(req);

  // A scoped caller with no accounts has nothing to chart, and an empty IN ()
  // is a SQL error rather than an empty result.
  if (accountIds !== null && accountIds.length === 0) {
    return { accountGrowth: [], subscriptionMix: [] };
  }

  const [signups, priorCount, subscriptionMix] = await Promise.all([
    accountIds === null
      ? prisma.$queryRaw<{ day: Date; count: bigint }[]>`
          SELECT date_trunc('day', "createdAt") AS day, COUNT(*) AS count
          FROM "Account"
          WHERE "createdAt" >= ${range.from} AND "createdAt" <= ${range.to}
          GROUP BY 1 ORDER BY 1
        `
      : prisma.$queryRaw<{ day: Date; count: bigint }[]>`
          SELECT date_trunc('day', "createdAt") AS day, COUNT(*) AS count
          FROM "Account"
          WHERE "createdAt" >= ${range.from} AND "createdAt" <= ${range.to}
            AND "id" = ANY(${accountIds})
          GROUP BY 1 ORDER BY 1
        `,
    prisma.account.count({
      where: {
        createdAt: { lt: range.from },
        ...(accountIds === null ? {} : { id: { in: accountIds } }),
      },
    }),
    prisma.subscription.groupBy({
      by: ["productId", "planId"],
      where: {
        status: { in: ["ACTIVE", "TRIAL"] },
        ...(accountIds === null ? {} : { accountId: { in: accountIds } }),
      },
      _count: { _all: true },
    }),
  ]);

  let running = priorCount;
  const accountGrowth = signups.map((row) => {
    running += Number(row.count ?? 0);
    return { date: row.day, count: running };
  });

  const products = await prisma.product.findMany({ select: { id: true, key: true, name: true } });
  const plans = await prisma.plan.findMany({ select: { id: true, key: true, name: true } });
  const productById = new Map(products.map((p) => [p.id, p]));
  const planById = new Map(plans.map((p) => [p.id, p]));

  return {
    accountGrowth,
    subscriptionMix: subscriptionMix.map((row) => ({
      productId: row.productId,
      product: productById.get(row.productId)?.name ?? `#${row.productId}`,
      planId: row.planId,
      plan: row.planId ? (planById.get(row.planId)?.name ?? null) : null,
      count: row._count._all,
    })),
  };
};

/** Account ids the caller may see, or null for unrestricted. */
const scopedAccountIdList = async (req: any): Promise<number[] | null> => {
  const where = accountWhere(req);
  if (!Object.keys(where).length) return null;
  const rows = await prisma.account.findMany({ where, select: { id: true } });
  return rows.map((row) => row.id);
};
