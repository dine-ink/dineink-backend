import prisma from "../../config/prisma";

export const getCashSessionsService = async (
  branchId: number,
  from?: string,
  to?: string,
) => {
  const dateFilter =
    from && to
      ? {
          businessDate: {
            gte: new Date(from),
            lte: new Date(to + "T23:59:59.999Z"),
          },
        }
      : {};

  const sessions = await prisma.dailyCashSession.findMany({
    where: { branchId, ...dateFilter },
    orderBy: { businessDate: "desc" },
  });

  // Enrich with user names via manual join (openedById / closedById are plain ints, not Prisma relations)
  const userIds = [
    ...new Set([
      ...sessions.map((s) => s.openedById).filter(Boolean),
      ...sessions.map((s) => s.closedById).filter(Boolean),
    ]),
  ] as number[];

  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, role: true },
        })
      : [];

  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  return sessions.map((s) => ({
    ...s,
    openedBy: s.openedById ? userMap[s.openedById] ?? null : null,
    closedBy: s.closedById ? userMap[s.closedById] ?? null : null,
  }));
};

export const openCashSessionService = async (data: {
  branchId: number;
  restaurantId: number;
  openedById: number;
  openingCash: number;
  businessDate?: string;
  notes?: string;
}) => {
  // One open session per cashier at a time (not per branch — a branch can
  // have several cashiers/tills open concurrently, each with their own
  // drawer). This replaces the old DB-level "one session per branch per
  // day" constraint, which would have blocked exactly that.
  const alreadyOpen = await prisma.dailyCashSession.findFirst({
    where: { openedById: data.openedById, branchId: data.branchId, status: "OPEN" },
  });
  if (alreadyOpen) {
    throw new Error("You already have an open cash session — close it before opening another.");
  }

  return prisma.dailyCashSession.create({
    data: {
      restaurant: { connect: { id: data.restaurantId } },
      branch:     { connect: { id: data.branchId     } },
      openedById: data.openedById,
      openingCash: data.openingCash,
      businessDate: data.businessDate ? new Date(data.businessDate) : new Date(),
      notes: data.notes,
      status: "OPEN",
      openedAt: new Date(),
    },
  });
};

// Revenue/bill-count/payment-method breakdown for THIS session's own
// open→(close or now) time window — not the whole business day. With
// several cashiers potentially holding concurrent sessions on the same
// branch/day, a whole-day figure would double-count the same sales across
// every one of their summaries instead of showing each their own shift.
export const getShiftSalesSummaryService = async (sessionId: number) => {
  const session = await prisma.dailyCashSession.findUnique({
    where: { id: sessionId },
    select: { branchId: true, openedAt: true, closedAt: true },
  });
  if (!session) throw new Error("Session not found");

  const windowEnd = session.closedAt ?? new Date();

  const bills = await prisma.bill.findMany({
    where: {
      branchId: session.branchId,
      status: "PAID",
      createdAt: { gte: session.openedAt, lte: windowEnd },
    },
    select: { total: true, paymentMethod: true },
  });

  const totalRevenue = bills.reduce((sum, b) => sum + b.total, 0);
  const billCount = bills.length;

  const breakdownMap: Record<string, { count: number; amount: number }> = {};
  for (const b of bills) {
    const method = (b.paymentMethod || "UNKNOWN").toUpperCase();
    if (!breakdownMap[method]) breakdownMap[method] = { count: 0, amount: 0 };
    breakdownMap[method].count += 1;
    breakdownMap[method].amount += b.total;
  }

  return {
    totalRevenue,
    billCount,
    avgBillValue: billCount > 0 ? totalRevenue / billCount : 0,
    paymentBreakdown: Object.entries(breakdownMap).map(([method, d]) => ({
      method,
      ...d,
    })),
  };
};

export const closeCashSessionService = async (
  sessionId: number,
  data: {
    closedById: number;
    actualCash: number;
    closingCash: number;
    notes?: string;
    expectedCash?: number;
  },
) => {
  const session = await prisma.dailyCashSession.findUnique({
    where: { id: sessionId },
    select: { openingCash: true, openedAt: true, branchId: true },
  });

  if (!session) throw new Error("Session not found");

  // Auto-calculate expected cash: opening + CASH bills during THIS session's
  // own open→now window — not the whole business day, which would count
  // another concurrent cashier's cash sales into this drawer's expectation.
  let expectedCash = data.expectedCash;
  if (expectedCash === undefined || expectedCash === null) {
    const cashBills = await prisma.bill.aggregate({
      where: {
        branchId: session.branchId,
        paymentMethod: { in: ["CASH", "cash"] },
        status: "PAID",
        createdAt: { gte: session.openedAt, lte: new Date() },
      },
      _sum: { total: true },
    });

    expectedCash = session.openingCash + (cashBills._sum.total ?? 0);
  }

  const cashDifference = data.actualCash - expectedCash;

  return prisma.dailyCashSession.update({
    where: { id: sessionId },
    data: {
      closedById:    data.closedById,
      actualCash:    data.actualCash,
      expectedCash,
      closingCash:   data.closingCash,
      cashDifference,
      notes:         data.notes,
      status:        "CLOSED",
      closedAt:      new Date(),
    },
  });
};
