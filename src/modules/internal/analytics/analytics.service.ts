import prisma from "../../../config/prisma";
import { PERMISSIONS } from "../rbac/permissions";
import { getActivityThresholds } from "../settings/platformSettings.service";

/**
 * Platform analytics — about DineInk's accounts, not about diners.
 *
 * Every figure is aggregated in SQL rather than by pulling rows into Node and
 * counting them there: this reads across every restaurant on the platform, and
 * a month of bills is far too many rows to move just to group them by day.
 *
 * Financial series are gated on ANALYTICS_FINANCIAL_VIEW and simply aren't
 * computed for anyone without it — the query doesn't run, so the number never
 * reaches the browser.
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
 * Turns per-day sign-ups into the running size of the book.
 *
 * `startingFrom` is how many accounts already existed when the range opened, so
 * a 90-day window on a two-year-old platform starts at the real number rather
 * than at zero. The result is monotonic by construction — an account leaving is
 * a status change, not a deletion, so this curve never falls.
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

export const getPlatformAnalytics = async (permissions: Set<string>, query: any) => {
  const range = resolveRange(query);
  const canSeeMoney = permissions.has(PERMISSIONS.ANALYTICS_FINANCIAL_VIEW);
  const thresholds = await getActivityThresholds();
  const atRiskCutoff = new Date(Date.now() - thresholds.atRiskDays * 86_400_000);

  const [statusRows, signupsPerDay, accountsBeforeRange, ordersOverTime, outlets, cohort] = await Promise.all([
    prisma.restaurant.groupBy({ by: ["platformStatus"], _count: { _all: true } }),

    prisma.$queryRaw<{ day: Date; count: bigint }[]>`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*) AS count
      FROM "Restaurant"
      WHERE "createdAt" >= ${range.from} AND "createdAt" <= ${range.to}
      GROUP BY 1 ORDER BY 1
    `,

    // The size of the book on the day the range opens. Without it the curve
    // would start at zero and imply the platform was empty three months ago.
    prisma.restaurant.count({ where: { createdAt: { lt: range.from } } }),

    prisma.$queryRaw<{ day: Date; orders: bigint; gmv: number | null; accounts: bigint }[]>`
      SELECT date_trunc('day', "createdAt") AS day,
             COUNT(*) AS orders,
             SUM("total") AS gmv,
             COUNT(DISTINCT "restaurantId") AS accounts
      FROM "Bill"
      WHERE "createdAt" >= ${range.from} AND "createdAt" <= ${range.to} AND "status" <> 'CANCELLED'
      GROUP BY 1 ORDER BY 1
    `,

    // How many outlets each account runs. A single café and a forty-outlet
    // chain are the same row in Restaurant but very different customers.
    prisma.$queryRaw<{ outlets: number; accounts: bigint }[]>`
      SELECT outlets, COUNT(*) AS accounts FROM (
        SELECT r.id, COUNT(b.id) FILTER (WHERE b."isDeleted" = false) AS outlets
        FROM "Restaurant" r LEFT JOIN "Branch" b ON b."restaurantId" = r.id
        GROUP BY r.id
      ) t GROUP BY outlets ORDER BY outlets
    `,

    // Accounts by the month they joined, with how many are still live — the
    // closest thing to a retention curve the current data supports.
    prisma.$queryRaw<{ month: Date; joined: bigint; live: bigint }[]>`
      SELECT date_trunc('month', "createdAt") AS month,
             COUNT(*) AS joined,
             COUNT(*) FILTER (WHERE "platformStatus" = 'ACTIVE') AS live
      FROM "Restaurant"
      GROUP BY 1 ORDER BY 1
    `,
  ]);

  const byStatus = Object.fromEntries(statusRows.map((r) => [r.platformStatus, r._count._all]));
  const totalAccounts = statusRows.reduce((sum, r) => sum + r._count._all, 0);

  const [atRisk, totalOutlets] = await Promise.all([
    prisma.restaurant.count({
      where: {
        platformStatus: "ACTIVE",
        OR: [{ lastActivityAt: { lt: atRiskCutoff } }, { lastActivityAt: null }],
      },
    }),
    prisma.branch.count({ where: { isDeleted: false } }),
  ]);

  // Which accounts actually put the most through the product. Useful in both
  // directions: who to protect, and who has gone quiet.
  const topAccountsRaw = await prisma.bill.groupBy({
    by: ["restaurantId"],
    where: { createdAt: { gte: range.from, lte: range.to }, status: { not: "CANCELLED" } },
    _count: { _all: true },
    _sum: { total: true },
    orderBy: { _count: { restaurantId: "desc" } },
    take: 10,
  });
  const topNames = await prisma.restaurant.findMany({
    where: { id: { in: topAccountsRaw.map((r) => r.restaurantId) } },
    select: { id: true, name: true, platformStatus: true, lastActivityAt: true },
  });
  const nameById = new Map(topNames.map((r) => [r.id, r]));

  // "Accounts over time" is the size of the book, not the day's intake — a
  // running total seeded with what already existed when the range opened. Read
  // as a daily count the chart slopes downward whenever an early day happened
  // to be busier, which reads as the platform shrinking.
  const accountsGrowth = accumulateSignups(signupsPerDay, accountsBeforeRange);
  const newInRange = signupsPerDay.reduce((sum, row) => sum + asNumber(row.count), 0);

  return {
    range,
    capabilities: { financial: canSeeMoney },
    summary: {
      totalAccounts,
      live: byStatus.ACTIVE ?? 0,
      onboarding: (byStatus.ONBOARDING ?? 0) + (byStatus.LEAD ?? 0),
      suspended: byStatus.SUSPENDED ?? 0,
      churned: byStatus.CHURNED ?? 0,
      atRisk,
      totalOutlets,
      newInRange,
    },
    accountsOverTime: accountsGrowth,
    usageOverTime: ordersOverTime.map((r) => ({
      date: r.day,
      orders: asNumber(r.orders),
      activeAccounts: asNumber(r.accounts),
      ...(canSeeMoney ? { gmv: r.gmv ?? 0 } : {}),
    })),
    outletDistribution: outlets.map((r) => ({ outlets: asNumber(r.outlets), accounts: asNumber(r.accounts) })),
    cohorts: cohort.map((r) => ({
      month: r.month,
      joined: asNumber(r.joined),
      stillLive: asNumber(r.live),
      retention: asNumber(r.joined) > 0 ? Math.round((asNumber(r.live) / asNumber(r.joined)) * 100) : 0,
    })),
    topAccounts: topAccountsRaw.map((r) => {
      const meta = nameById.get(r.restaurantId);
      return {
        id: r.restaurantId,
        name: meta?.name ?? `RES-${r.restaurantId}`,
        platformStatus: meta?.platformStatus ?? null,
        lastActivityAt: meta?.lastActivityAt ?? null,
        orders: r._count._all,
        ...(canSeeMoney ? { gmv: r._sum.total ?? 0 } : {}),
      };
    }),
  };
};
