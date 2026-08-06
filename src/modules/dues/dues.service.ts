import prisma from "../../config/prisma";
import { ForbiddenError } from "./dues.validation";
import { getUpcomingEmiDuesService } from "../emi/emi.service";
import { computePeriodMetrics } from "../finance/finance.service";
import { startOfMonth, endOfMonth, DateRange } from "../../utils/dateRange";

// ── Monthly Dues (EB / Salaries / Rent / Operations / Utilities / Maintenance / Misc / EMI) ──

export const getMonthlyDuesService = async (
  restaurantId: number,
  branchId: number,
  month?: number,
  year?: number,
) => {
  return prisma.monthlyDue.findMany({
    where: {
      restaurantId,
      branchId,
      ...(month !== undefined ? { month } : {}),
      ...(year !== undefined ? { year } : {}),
    },
    orderBy: { category: "asc" },
  });
};

export const createMonthlyDueService = async (
  callerRestaurantId: number,
  data: {
    branchId: number;
    category: string;
    month: number;
    year: number;
    amountDue: number;
    dueDate?: string;
    notes?: string;
    createdById?: number;
  },
) => {
  // branchId is only carried in the body here (POST / has no route param to
  // check ownership against up front), so verify it belongs to the caller's
  // own restaurant the same way createVendorPaymentService/
  // createVendorInvoiceService verify vendorId — otherwise any authenticated
  // user could file a due against another restaurant's branch.
  const branch = await prisma.branch.findUnique({
    where: { id: data.branchId },
    select: { restaurantId: true },
  });
  if (!branch || branch.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this branch");
  }

  return prisma.monthlyDue.create({
    data: {
      restaurantId: callerRestaurantId,
      branchId:     data.branchId,
      category:     data.category,
      month:        data.month,
      year:         data.year,
      amountDue:    data.amountDue,
      amountPaid:   0,
      dueDate:      data.dueDate ? new Date(data.dueDate) : null,
      status:       "PENDING",
      notes:        data.notes,
      createdById:  data.createdById,
    },
  });
};

/**
 * PAID if fully covered, PARTIAL if something (but not everything) has been
 * paid, OVERDUE if the due date has already passed and it isn't fully paid,
 * else PENDING. Order matters: PAID/PARTIAL are checked before OVERDUE so a
 * fully- or partially-paid due doesn't get relabelled OVERDUE just because
 * its due date is in the past.
 */
const computeDueStatus = (amountDue: number, amountPaid: number, dueDate: Date | null): string => {
  if (amountPaid >= amountDue) return "PAID";
  if (amountPaid > 0 && amountPaid < amountDue) return "PARTIAL";
  if (dueDate && dueDate.getTime() < Date.now()) return "OVERDUE";
  return "PENDING";
};

export const updateMonthlyDueService = async (
  callerRestaurantId: number,
  id: number,
  data: Partial<{
    amountDue: number;
    amountPaid: number;
    dueDate: string;
    paidDate: string;
    notes: string;
  }>,
) => {
  const existing = await prisma.monthlyDue.findUnique({ where: { id } });
  if (!existing) throw new Error("Monthly due not found");
  if (existing.restaurantId !== callerRestaurantId) throw new ForbiddenError("You do not have access to this monthly due");

  const amountDue = data.amountDue ?? existing.amountDue;
  const amountPaid = data.amountPaid ?? existing.amountPaid;
  const dueDate = data.dueDate !== undefined ? new Date(data.dueDate) : existing.dueDate;
  const paidDate = data.paidDate !== undefined ? new Date(data.paidDate) : existing.paidDate;
  const status = computeDueStatus(amountDue, amountPaid, dueDate);

  return prisma.monthlyDue.update({
    where: { id },
    data: {
      amountDue,
      amountPaid,
      dueDate,
      paidDate,
      notes: data.notes !== undefined ? data.notes : existing.notes,
      status,
    },
  });
};

export const deleteMonthlyDueService = async (callerRestaurantId: number, id: number) => {
  const existing = await prisma.monthlyDue.findUnique({ where: { id }, select: { restaurantId: true } });
  if (!existing) throw new Error("Monthly due not found");
  if (existing.restaurantId !== callerRestaurantId) throw new ForbiddenError("You do not have access to this monthly due");
  return prisma.monthlyDue.delete({ where: { id } });
};

// ── Payment Calendar ──────────────────────────────────────────────────────────
//
// Merges three independent sources into one sorted "what's due when" list
// without duplicating any of their logic:
//   - MonthlyDue: this module's own rows (EB/Salaries/Rent/etc.) with a
//     dueDate set.
//   - VendorInvoice: purchasing invoices from the vendors module that are
//     still unpaid, read directly via prisma — no vendor.service.ts helper
//     already returns a plain date-ranged, unpaid-only list.
//   - EmiSchedule: reuses getUpcomingEmiDuesService from the emi module
//     (already built as "a shared building block for Cash Flow Predictor /
//     Dues Tracker") instead of re-deriving month-by-month due dates from
//     dueDayOfMonth/tenureMonths here.
export type PaymentCalendarSource = "MONTHLY_DUE" | "VENDOR_INVOICE" | "EMI";

export interface PaymentCalendarEntry {
  source: PaymentCalendarSource;
  id: number;
  label: string;
  amount: number;
  dueDate: Date;
}

export const getPaymentCalendarService = async (
  restaurantId: number,
  branchId: number,
  fromDate: Date,
  toDate: Date,
): Promise<PaymentCalendarEntry[]> => {
  const [monthlyDues, vendorInvoices, emiDues] = await Promise.all([
    prisma.monthlyDue.findMany({
      where: { restaurantId, branchId, dueDate: { gte: fromDate, lte: toDate } },
    }),
    prisma.vendorInvoice.findMany({
      where: {
        restaurantId,
        branchId,
        dueDate: { gte: fromDate, lte: toDate },
        status: { not: "PAID" },
      },
    }),
    // Fetched restaurant-wide (branchId left undefined) and filtered below,
    // because EmiSchedule.branchId being null means "restaurant-wide" — a
    // strict branchId-equality filter inside getUpcomingEmiDuesService would
    // wrongly exclude those restaurant-wide schedules from this branch's
    // calendar.
    getUpcomingEmiDuesService(restaurantId, undefined, fromDate, toDate),
  ]);

  const merged: PaymentCalendarEntry[] = [
    ...monthlyDues
      .filter((d) => d.dueDate)
      .map((d) => ({
        source: "MONTHLY_DUE" as const,
        id: d.id,
        label: d.category,
        amount: d.amountDue,
        dueDate: d.dueDate as Date,
      })),
    ...vendorInvoices
      .filter((v) => v.dueDate)
      .map((v) => ({
        source: "VENDOR_INVOICE" as const,
        id: v.id,
        label: v.invoiceNumber || `Invoice #${v.id}`,
        amount: v.totalAmount,
        dueDate: v.dueDate as Date,
      })),
    ...emiDues
      .filter((e) => e.branchId === branchId || e.branchId === null)
      .map((e) => ({
        source: "EMI" as const,
        id: e.id,
        label: e.name,
        amount: e.emiAmount,
        dueDate: e.dueDate,
      })),
  ];

  return merged.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
};

// ── Month-over-Month Comparison ───────────────────────────────────────────────

interface CategoryTotal {
  category: string;
  amountDue: number;
  amountPaid: number;
}

const aggregateByCategory = (rows: { category: string; amountDue: number; amountPaid: number }[]): CategoryTotal[] => {
  const byCategory = new Map<string, CategoryTotal>();
  for (const row of rows) {
    const entry = byCategory.get(row.category) ?? { category: row.category, amountDue: 0, amountPaid: 0 };
    entry.amountDue += row.amountDue;
    entry.amountPaid += row.amountPaid;
    byCategory.set(row.category, entry);
  }
  return Array.from(byCategory.values());
};

export const getMonthComparisonService = async (
  restaurantId: number,
  branchId: number,
  month: number,
  year: number,
) => {
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;

  const [currentRows, previousRows] = await Promise.all([
    prisma.monthlyDue.findMany({ where: { restaurantId, branchId, month, year } }),
    prisma.monthlyDue.findMany({ where: { restaurantId, branchId, month: previousMonth, year: previousYear } }),
  ]);

  const current = aggregateByCategory(currentRows);
  const previous = aggregateByCategory(previousRows);

  const categories = new Set<string>([...current.map((c) => c.category), ...previous.map((c) => c.category)]);
  const changePercent = Array.from(categories).map((category) => {
    const currentAmount = current.find((c) => c.category === category)?.amountDue ?? 0;
    const previousAmount = previous.find((c) => c.category === category)?.amountDue ?? 0;
    const pct =
      previousAmount > 0
        ? Math.round(((currentAmount - previousAmount) / previousAmount) * 1000) / 10
        : currentAmount > 0
          ? 100
          : 0;
    return { category, pct };
  });

  return { current, previous, changePercent };
};

// ── EBITDA Summary ────────────────────────────────────────────────────────────
//
// Delegates entirely to computePeriodMetrics (finance.service.ts), which
// itself calls computeFinancialMetrics -> computeEBITDA (finance.formulas.ts)
// — the single source of truth for EBITDA used by every other screen. This
// gathers the RestaurantInsights + DateRange inputs the exact same way
// getFinancialSummaryService does, rather than recomputing revenue/food
// cost/labour cost/expenses independently here.
export const getEbitdaSummaryService = async (
  restaurantId: number,
  branchId: number,
  month: number,
  year: number,
) => {
  const anchor = new Date(year, month - 1, 1);
  const range: DateRange = { startDate: startOfMonth(anchor), endDate: endOfMonth(anchor) };

  const insights = await prisma.restaurantInsights.findUnique({
    where: { restaurantId_branchId: { restaurantId, branchId } },
  });

  const metrics = await computePeriodMetrics(restaurantId, branchId, range, insights);

  return { month, year, ...metrics };
};
