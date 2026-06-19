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
  return prisma.dailyCashSession.create({
    data: {
      branchId: data.branchId,
      restaurantId: data.restaurantId,
      openedById: data.openedById,
      openingCash: data.openingCash,
      businessDate: data.businessDate ? new Date(data.businessDate) : new Date(),
      notes: data.notes,
      status: "OPEN",
      openedAt: new Date(),
    },
  });
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
    select: { openingCash: true, businessDate: true, branchId: true },
  });

  if (!session) throw new Error("Session not found");

  // Auto-calculate expected cash: opening + all CASH bill totals on that business day
  let expectedCash = data.expectedCash;
  if (expectedCash === undefined || expectedCash === null) {
    const dayStart = new Date(session.businessDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(session.businessDate);
    dayEnd.setHours(23, 59, 59, 999);

    const cashBills = await prisma.bill.aggregate({
      where: {
        branchId: session.branchId,
        paymentMethod: { in: ["CASH", "cash"] },
        createdAt: { gte: dayStart, lte: dayEnd },
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
