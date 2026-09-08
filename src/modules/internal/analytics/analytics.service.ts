import prisma from "../../../config/prisma";
import { PERMISSIONS } from "../rbac/permissions";
import { accountWhere, relatedAccountWhere } from "../rbac/scope";

/**
 * DineInk's own SaaS analytics.
 *
 * This describes the software business — customers, products, plans,
 * subscriptions, revenue — and deliberately not our customers' restaurant
 * trade, which owner-web already reports to the restaurant itself. The previous
 * version measured order volume and GMV, which are numbers about someone else's
 * business.
 *
 * Two rules run through the whole module:
 *
 *  - **Nothing is fabricated.** Revenue is computed only from invoices actually
 *    raised, and MRR only from subscriptions whose plan has a configured price.
 *    Dineink has not supplied pricing, so today most of these return zero with
 *    an explicit `coverage` figure saying how much of the book they could see.
 *    A number that silently covered 20% of subscriptions would be worse than no
 *    number at all.
 *
 *  - **Everything is scoped.** An assigned-only employee gets analytics for
 *    their own accounts, not for the company.
 */

export interface AnalyticsRange {
  from: Date;
  to: Date;
}

export const resolveRange = (query: any): AnalyticsRange => {
  const to = query?.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date();
  const from = query?.from ? new Date(query.from) : new Date(to.getTime() - 89 * 86_400_000);
  return { from, to };
};

const asNumber = (value: unknown) => Number(value ?? 0);

/**
 * Turns per-day sign-ups into the running size of the customer book.
 *
 * `startingFrom` is how many accounts already existed when the range opened, so
 * a 90-day window on a two-year-old business starts at the real number rather
 * than at zero. Monotonic by construction: an account leaving is a lifecycle
 * change, not a deletion, so this curve never falls.
 */
export const accumulateSignups = (
  perDay: { day: Date; count: bigint | number }[],
  startingFrom: number,
): { date: Date; count: number }[] => {
  let running = startingFrom;
  return perDay.map((row) => {
    running += Number(row.count ?? 0);
    return { date: row.day, count: running };
  });
};

/**
 * Normalises a plan price to a monthly figure.
 *
 * Returns null — not zero — when the plan has no price or no interval. Null
 * means "cannot be counted"; zero would mean "contributes nothing", and the two
 * produce very different MRR totals from the same data.
 */
export const monthlyValue = (
  amount: number | null | undefined,
  interval: string | null | undefined,
): number | null => {
  if (amount === null || amount === undefined || !interval) return null;
  switch (interval) {
    case "MONTHLY":
      return amount;
    case "QUARTERLY":
      return amount / 3;
    case "ANNUAL":
      return amount / 12;
    default:
      return null;
  }
};

export const getPlatformAnalytics = async (req: any, permissions: Set<string>, query: any) => {
  const range = resolveRange(query);
  const canSeeMoney = permissions.has(PERMISSIONS.ANALYTICS_FINANCIAL_VIEW);

  const scopedAccounts = accountWhere(req);
  const scopedByAccount = relatedAccountWhere(req);

  const [statusRows, signupsPerDay, accountsBeforeRange, subscriptionRows, onboardingRows] = await Promise.all([
    prisma.account.groupBy({ by: ["status"], where: scopedAccounts, _count: { _all: true } }),

    scopedSignupsPerDay(req, range),

    prisma.account.count({ where: { ...scopedAccounts, createdAt: { lt: range.from } } }),

    prisma.subscription.findMany({
      where: scopedByAccount,
      select: {
        id: true,
        status: true,
        startDate: true,
        renewalDate: true,
        billingInterval: true,
        productId: true,
        planId: true,
        product: { select: { key: true, name: true } },
        plan: {
          select: { key: true, name: true, priceAmount: true, currency: true, billingInterval: true },
        },
      },
    }),

    prisma.onboarding.groupBy({ by: ["status"], where: scopedByAccount, _count: { _all: true } }),
  ]);

  const byStatus = Object.fromEntries(statusRows.map((row) => [row.status, row._count._all]));
  const totalAccounts = statusRows.reduce((sum, row) => sum + row._count._all, 0);
  const newInRange = signupsPerDay.reduce((sum, row) => sum + asNumber(row.count), 0);

  // ─── Product & plan mix ───────────────────────────────────────────────────
  const live = subscriptionRows.filter((s) => s.status === "ACTIVE" || s.status === "TRIAL");

  const productMix = new Map<string, { key: string; name: string; count: number }>();
  const planMix = new Map<string, { productKey: string; key: string; name: string; count: number }>();
  for (const sub of live) {
    const pk = sub.product.key;
    const product = productMix.get(pk) ?? { key: pk, name: sub.product.name, count: 0 };
    product.count += 1;
    productMix.set(pk, product);

    if (sub.plan) {
      const composite = `${pk}::${sub.plan.key}`;
      const plan = planMix.get(composite) ?? {
        productKey: pk,
        key: sub.plan.key,
        name: sub.plan.name,
        count: 0,
      };
      plan.count += 1;
      planMix.set(composite, plan);
    }
  }

  const subscriptionsByStatus = subscriptionRows.reduce<Record<string, number>>((acc, sub) => {
    acc[sub.status] = (acc[sub.status] ?? 0) + 1;
    return acc;
  }, {});

  // ─── Recurring revenue ────────────────────────────────────────────────────
  //
  // Computed only from subscriptions whose plan carries a price and an
  // interval. `coverage` says how many of the live subscriptions that was, so
  // the UI can state plainly that MRR reflects part of the book rather than
  // presenting a partial figure as a total.
  let recurring: {
    mrr: number;
    arr: number;
    currency: string | null;
    coverage: { priced: number; total: number };
  } | null = null;

  if (canSeeMoney) {
    let mrr = 0;
    let priced = 0;
    const currencies = new Set<string>();
    for (const sub of live) {
      const amount = sub.plan?.priceAmount === null || sub.plan?.priceAmount === undefined
        ? null
        : Number(sub.plan.priceAmount);
      // The subscription's own interval wins over the plan's: it was copied at
      // signature time and is what the customer actually agreed to.
      const interval = sub.billingInterval ?? sub.plan?.billingInterval ?? null;
      const monthly = monthlyValue(amount, interval);
      if (monthly !== null) {
        mrr += monthly;
        priced += 1;
        if (sub.plan?.currency) currencies.add(sub.plan.currency);
      }
    }
    recurring = {
      mrr: Math.round(mrr * 100) / 100,
      arr: Math.round(mrr * 12 * 100) / 100,
      // Mixed currencies cannot be summed. Reporting null rather than picking
      // one is what stops a total that silently adds rupees to dollars.
      currency: currencies.size === 1 ? [...currencies][0] : null,
      coverage: { priced, total: live.length },
    };
  }

  // ─── Billed revenue ───────────────────────────────────────────────────────
  // What was actually invoiced and actually collected in the range. Unlike MRR
  // this needs no pricing configuration — it reads real invoices.
  let billed: {
    invoiced: number;
    collected: number;
    outstanding: number;
    invoiceCount: number;
    byMonth: { month: string; invoiced: number; collected: number }[];
  } | null = null;

  if (canSeeMoney) {
    const [totals, monthly] = await Promise.all([
      prisma.invoice.aggregate({
        where: {
          ...scopedByAccount,
          status: { notIn: ["DRAFT", "VOID"] },
          issueDate: { gte: range.from, lte: range.to },
        },
        _sum: { total: true, amountPaid: true },
        _count: { _all: true },
      }),
      scopedInvoicesByMonth(req, range),
    ]);
    const invoiced = Number(totals._sum.total ?? 0);
    const collected = Number(totals._sum.amountPaid ?? 0);
    billed = {
      invoiced,
      collected,
      outstanding: Math.max(0, invoiced - collected),
      invoiceCount: totals._count._all,
      byMonth: monthly,
    };
  }

  // ─── Churn & retention ────────────────────────────────────────────────────
  //
  // Churn is measured from lifecycle changes, which are recorded events, rather
  // than inferred from how much someone used the product.
  const [churnedInRange, customersAtRangeStart] = await Promise.all([
    prisma.account.count({
      where: { ...scopedAccounts, status: "CHURNED", churnedAt: { gte: range.from, lte: range.to } },
    }),
    prisma.account.count({
      where: { ...scopedAccounts, becameCustomerAt: { lt: range.from } },
    }),
  ]);

  const cohorts = await scopedCohorts(req);

  // ─── Support load ─────────────────────────────────────────────────────────
  let support: {
    open: number;
    createdInRange: number;
    resolvedInRange: number;
    escalated: number;
    medianResolutionHours: number | null;
  } | null = null;

  if (permissions.has(PERMISSIONS.TICKET_VIEW)) {
    const ticketWhere = Object.keys(scopedByAccount).length ? scopedByAccount : {};
    const [open, createdInRange, resolved, escalated, resolutionSamples] = await Promise.all([
      prisma.supportTicket.count({ where: { ...ticketWhere, status: { notIn: ["RESOLVED", "CLOSED"] } } }),
      prisma.supportTicket.count({ where: { ...ticketWhere, createdAt: { gte: range.from, lte: range.to } } }),
      prisma.supportTicket.count({
        where: { ...ticketWhere, resolvedAt: { gte: range.from, lte: range.to } },
      }),
      prisma.supportTicket.count({
        where: { ...ticketWhere, status: { in: ["ESCALATED_TO_ENGINEERING", "ENGINEERING_RESOLVED"] } },
      }),
      prisma.supportTicket.findMany({
        where: { ...ticketWhere, resolvedAt: { gte: range.from, lte: range.to } },
        select: { createdAt: true, resolvedAt: true },
        take: 1000,
      }),
    ]);

    // Median, not mean: one ticket that sat open over a holiday drags an
    // average somewhere no real ticket ever was.
    const hours = resolutionSamples
      .filter((t) => t.resolvedAt)
      .map((t) => (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 3_600_000)
      .sort((a, b) => a - b);
    const median = hours.length
      ? hours.length % 2
        ? hours[(hours.length - 1) / 2]
        : (hours[hours.length / 2 - 1] + hours[hours.length / 2]) / 2
      : null;

    support = {
      open,
      createdInRange,
      resolvedInRange: resolved,
      escalated,
      medianResolutionHours: median === null ? null : Math.round(median * 10) / 10,
    };
  }

  const onboardingByStatus = Object.fromEntries(
    onboardingRows.map((row) => [row.status, row._count._all]),
  );

  return {
    range,
    capabilities: { financial: canSeeMoney },
    summary: {
      totalAccounts,
      customers: byStatus.CUSTOMER ?? 0,
      leads: byStatus.LEAD ?? 0,
      prospects: byStatus.PROSPECT ?? 0,
      churned: byStatus.CHURNED ?? 0,
      newInRange,
      churnedInRange,
      // The denominator is customers who existed when the window opened, so a
      // customer won and lost inside the range doesn't distort the rate.
      churnRate:
        customersAtRangeStart > 0
          ? Math.round((churnedInRange / customersAtRangeStart) * 1000) / 10
          : null,
    },
    accountGrowth: accumulateSignups(signupsPerDay, accountsBeforeRange),
    productMix: [...productMix.values()].sort((a, b) => b.count - a.count),
    planMix: [...planMix.values()].sort((a, b) => b.count - a.count),
    subscriptions: {
      total: subscriptionRows.length,
      byStatus: {
        TRIAL: subscriptionsByStatus.TRIAL ?? 0,
        ACTIVE: subscriptionsByStatus.ACTIVE ?? 0,
        PAST_DUE: subscriptionsByStatus.PAST_DUE ?? 0,
        PAUSED: subscriptionsByStatus.PAUSED ?? 0,
        CANCELLED: subscriptionsByStatus.CANCELLED ?? 0,
        EXPIRED: subscriptionsByStatus.EXPIRED ?? 0,
      },
    },
    onboarding: {
      NOT_STARTED: onboardingByStatus.NOT_STARTED ?? 0,
      IN_PROGRESS: onboardingByStatus.IN_PROGRESS ?? 0,
      BLOCKED: onboardingByStatus.BLOCKED ?? 0,
      READY_FOR_GO_LIVE: onboardingByStatus.READY_FOR_GO_LIVE ?? 0,
      LIVE: onboardingByStatus.LIVE ?? 0,
      COMPLETED: onboardingByStatus.COMPLETED ?? 0,
    },
    recurring,
    billed,
    cohorts,
    support,
  };
};

// ─── Scoped raw queries ──────────────────────────────────────────────────────
//
// Prisma's `where` cannot be folded into $queryRaw, so scoped variants pass an
// explicit id list. A caller with global scope gets the unfiltered query rather
// than a list of every id in the table.

const scopedAccountIds = async (req: any): Promise<number[] | null> => {
  const where = accountWhere(req);
  if (!Object.keys(where).length) return null;
  const rows = await prisma.account.findMany({ where, select: { id: true } });
  return rows.map((row) => row.id);
};

const scopedSignupsPerDay = async (req: any, range: AnalyticsRange) => {
  const ids = await scopedAccountIds(req);
  if (ids !== null && ids.length === 0) return [];
  return ids === null
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
          AND "id" = ANY(${ids})
        GROUP BY 1 ORDER BY 1
      `;
};

const scopedInvoicesByMonth = async (req: any, range: AnalyticsRange) => {
  const ids = await scopedAccountIds(req);
  if (ids !== null && ids.length === 0) return [];
  const rows =
    ids === null
      ? await prisma.$queryRaw<{ month: Date; invoiced: number | null; collected: number | null }[]>`
          SELECT date_trunc('month', "issueDate") AS month,
                 SUM("total")      AS invoiced,
                 SUM("amountPaid") AS collected
          FROM "Invoice"
          WHERE "status" NOT IN ('DRAFT', 'VOID')
            AND "issueDate" >= ${range.from} AND "issueDate" <= ${range.to}
          GROUP BY 1 ORDER BY 1
        `
      : await prisma.$queryRaw<{ month: Date; invoiced: number | null; collected: number | null }[]>`
          SELECT date_trunc('month', "issueDate") AS month,
                 SUM("total")      AS invoiced,
                 SUM("amountPaid") AS collected
          FROM "Invoice"
          WHERE "status" NOT IN ('DRAFT', 'VOID')
            AND "issueDate" >= ${range.from} AND "issueDate" <= ${range.to}
            AND "accountId" = ANY(${ids})
          GROUP BY 1 ORDER BY 1
        `;
  return rows.map((row) => ({
    month: row.month.toISOString().slice(0, 7),
    invoiced: Number(row.invoiced ?? 0),
    collected: Number(row.collected ?? 0),
  }));
};

/**
 * Retention by the month a customer was won, derived from recorded events.
 *
 * The previous version asked "joined in month X, and is a CUSTOMER today?",
 * which cannot see a customer who churned and came back, and silently treated
 * every backfilled account as though its history were known.
 *
 * This reads AccountLifecycleEvent. Rows marked `isBackfilled` are the single
 * synthetic entry each pre-existing account received when the table was
 * introduced — they carry the account's creation date because that is all
 * anyone knew. They are counted separately and reported as `unknownHistory`
 * rather than folded into the numbers, so a cohort built on guesswork is
 * visibly distinguishable from one built on record.
 */
const scopedCohorts = async (req: any) => {
  const ids = await scopedAccountIds(req);
  if (ids !== null && ids.length === 0) return [];

  const rows =
    ids === null
      ? await prisma.$queryRaw<
          { month: Date; won: bigint; churned: bigint; backfilled: bigint }[]
        >`
          WITH first_won AS (
            SELECT "accountId",
                   MIN("createdAt")                                  AS won_at,
                   bool_or("isBackfilled")                            AS from_backfill
            FROM "AccountLifecycleEvent"
            WHERE "toStatus" = 'CUSTOMER'
            GROUP BY "accountId"
          )
          SELECT date_trunc('month', f.won_at)                                        AS month,
                 COUNT(*)                                                              AS won,
                 COUNT(*) FILTER (WHERE a."status" = 'CHURNED')                        AS churned,
                 COUNT(*) FILTER (WHERE f.from_backfill)                               AS backfilled
          FROM first_won f
          JOIN "Account" a ON a."id" = f."accountId"
          GROUP BY 1 ORDER BY 1
        `
      : await prisma.$queryRaw<
          { month: Date; won: bigint; churned: bigint; backfilled: bigint }[]
        >`
          WITH first_won AS (
            SELECT "accountId",
                   MIN("createdAt")                                  AS won_at,
                   bool_or("isBackfilled")                            AS from_backfill
            FROM "AccountLifecycleEvent"
            WHERE "toStatus" = 'CUSTOMER' AND "accountId" = ANY(${ids})
            GROUP BY "accountId"
          )
          SELECT date_trunc('month', f.won_at)                                        AS month,
                 COUNT(*)                                                              AS won,
                 COUNT(*) FILTER (WHERE a."status" = 'CHURNED')                        AS churned,
                 COUNT(*) FILTER (WHERE f.from_backfill)                               AS backfilled
          FROM first_won f
          JOIN "Account" a ON a."id" = f."accountId"
          GROUP BY 1 ORDER BY 1
        `;

  return rows.map((row) => {
    const won = asNumber(row.won);
    const churned = asNumber(row.churned);
    const backfilled = asNumber(row.backfilled);
    return {
      month: row.month.toISOString().slice(0, 7),
      joined: won,
      stillCustomers: won - churned,
      retention: won > 0 ? Math.round(((won - churned) / won) * 100) : 0,
      /// How many of this cohort's "won" dates are the backfilled placeholder
      /// rather than a recorded event. The UI labels a cohort that is mostly
      /// placeholder rather than presenting it as measured.
      unknownHistory: backfilled,
    };
  });
};

/**
 * How many customers existed on a given date, from recorded transitions.
 *
 * Only answerable for dates after lifecycle history started being written.
 * Returns null for anything earlier rather than extrapolating backwards from
 * today's statuses, which is what produced the previous approximation.
 */
export const customersAsOf = async (req: any, at: Date): Promise<number | null> => {
  const ids = await scopedAccountIds(req);
  if (ids !== null && ids.length === 0) return 0;

  const earliest = await prisma.accountLifecycleEvent.findFirst({
    where: { isBackfilled: false },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  // Before the first real event there is nothing to reconstruct from. Saying so
  // beats returning a number that looks like a measurement.
  if (!earliest || at < earliest.createdAt) return null;

  // Two whole queries rather than one with a spliced fragment: Prisma's tagged
  // template cannot be composed that way, and building the SQL by hand would
  // mean interpolating the id list into the string.
  const rows =
    ids === null
      ? await prisma.$queryRaw<{ count: bigint }[]>`
          WITH latest AS (
            SELECT DISTINCT ON ("accountId") "accountId", "toStatus"
            FROM "AccountLifecycleEvent"
            WHERE "createdAt" <= ${at}
            ORDER BY "accountId", "createdAt" DESC
          )
          SELECT COUNT(*) AS count FROM latest WHERE "toStatus" = 'CUSTOMER'
        `
      : await prisma.$queryRaw<{ count: bigint }[]>`
          WITH latest AS (
            SELECT DISTINCT ON ("accountId") "accountId", "toStatus"
            FROM "AccountLifecycleEvent"
            WHERE "createdAt" <= ${at} AND "accountId" = ANY(${ids})
            ORDER BY "accountId", "createdAt" DESC
          )
          SELECT COUNT(*) AS count FROM latest WHERE "toStatus" = 'CUSTOMER'
        `;

  return asNumber(rows[0]?.count);
};
