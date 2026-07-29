import prisma from "../../config/prisma";

// ─── Expenses Report ──────────────────────────────────────────────────────────

export const getExpensesReportService = async (
  branchId: number,
  from?: string,
  to?: string,
) => {
  // Every real caller passes from/to (the global date-range picker) — this
  // fallback only guards against a missing/malformed query param ever
  // returning the branch's entire expense history unbounded.
  const defaultFrom = new Date();
  defaultFrom.setFullYear(defaultFrom.getFullYear() - 1);

  const dateFilter = {
    expenseDate: {
      gte: from ? new Date(from) : defaultFrom,
      lte: to ? new Date(to + "T23:59:59.999Z") : new Date(),
    },
  };

  return prisma.shopExpense.findMany({
    where: { branchId, ...dateFilter },
    include: {
      paidByUser: { select: { id: true, name: true, role: true } },
    },
    orderBy: { expenseDate: "desc" },
  });
};

// ─── GST Filing Report (GSTR-3B "Table 3.1(a)" style monthly summary) ───────
//
// Every bill in this app carries a single GST rate for the whole order
// (BillingSettings.gstPercentage is set per branch, not per item), so an
// accurate month-wise outward-supply summary can be built directly from
// Bill.subtotal/cgst/sgst — no HSN-level breakup exists in the schema, so
// this covers the B2C summary tables an accountant needs, not invoice-wise
// B2B detail.

export const getGstFilingReportService = async (
  restaurantId: number,
  branchId: number,
  from?: string,
  to?: string,
) => {
  // Every real caller passes from/to (the global date-range picker) — this
  // fallback only guards against a missing/malformed query param ever
  // returning the branch's entire paid-bill history unbounded, matching the
  // same defensive default already used by getExpensesReportService above.
  const defaultFrom = new Date();
  defaultFrom.setFullYear(defaultFrom.getFullYear() - 1);

  const dateFilter = {
    createdAt: {
      gte: from ? new Date(from) : defaultFrom,
      lte: to ? new Date(to + "T23:59:59.999Z") : new Date(),
    },
  };

  const [restaurant, branch, billingSettings, bills] = await Promise.all([
    prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { name: true, gstNumber: true },
    }),
    prisma.branch.findUnique({
      where: { id: branchId },
      select: { name: true, address: true, state: true },
    }),
    prisma.billingSettings.findUnique({
      where: { branchId },
      select: { gstPercentage: true },
    }),
    prisma.bill.findMany({
      where: { restaurantId, branchId, status: "PAID", ...dateFilter },
      select: {
        billNo: true,
        subtotal: true,
        cgst: true,
        sgst: true,
        total: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const monthMap: Record<
    string,
    { month: string; invoiceCount: number; taxableValue: number; cgst: number; sgst: number; invoiceValue: number }
  > = {};

  for (const b of bills) {
    const month = new Date(b.createdAt).toISOString().slice(0, 7); // "YYYY-MM"
    if (!monthMap[month]) {
      monthMap[month] = { month, invoiceCount: 0, taxableValue: 0, cgst: 0, sgst: 0, invoiceValue: 0 };
    }
    const m = monthMap[month];
    m.invoiceCount += 1;
    m.taxableValue += b.subtotal;
    m.cgst += b.cgst || 0;
    m.sgst += b.sgst || 0;
    m.invoiceValue += b.total;
  }

  const monthly = Object.values(monthMap)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({
      ...m,
      taxableValue: Math.round(m.taxableValue * 100) / 100,
      cgst: Math.round(m.cgst * 100) / 100,
      sgst: Math.round(m.sgst * 100) / 100,
      totalTax: Math.round((m.cgst + m.sgst) * 100) / 100,
      invoiceValue: Math.round(m.invoiceValue * 100) / 100,
    }));

  const grandTotal = monthly.reduce(
    (acc, m) => ({
      invoiceCount: acc.invoiceCount + m.invoiceCount,
      taxableValue: acc.taxableValue + m.taxableValue,
      cgst: acc.cgst + m.cgst,
      sgst: acc.sgst + m.sgst,
      totalTax: acc.totalTax + m.totalTax,
      invoiceValue: acc.invoiceValue + m.invoiceValue,
    }),
    { invoiceCount: 0, taxableValue: 0, cgst: 0, sgst: 0, totalTax: 0, invoiceValue: 0 },
  );

  return {
    restaurant: restaurant || null,
    branch: branch || null,
    gstPercentage: billingSettings?.gstPercentage ?? null,
    monthly,
    grandTotal,
  };
};
