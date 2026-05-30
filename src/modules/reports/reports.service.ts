import prisma from "../../config/prisma";

// ─── Expenses Report ──────────────────────────────────────────────────────────

export const getExpensesReportService = async (
  branchId: number,
  from?: string,
  to?: string,
) => {
  const dateFilter =
    from && to
      ? {
          expenseDate: {
            gte: new Date(from),
            lte: new Date(to + "T23:59:59.999Z"),
          },
        }
      : {};

  return prisma.shopExpense.findMany({
    where: { branchId, ...dateFilter },
    include: {
      paidByUser: { select: { id: true, name: true, role: true } },
    },
    orderBy: { expenseDate: "desc" },
  });
};
