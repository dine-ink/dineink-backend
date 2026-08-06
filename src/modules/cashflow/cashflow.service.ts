// Cash Flow Predictor — a computed-on-demand projection that nets already-
// existing data (VendorInvoice, EmiSchedule, User.salary, ComplianceRecord,
// Bill) rather than persisting a new table of its own. Every number here is
// derived from another module's existing service/query, never re-derived
// from scratch:
//   - Outflow calendar (vendor invoices + EMI dues in range): reuses
//     getPaymentCalendarService (dues module), which already merges
//     MonthlyDue/VendorInvoice/EmiSchedule instead of re-querying them here.
//   - GST outflow estimate: reuses computeNextGstFilingDueDate (compliance
//     module) for "is a filing due in this window" and getGstFilingReportService
//     (reports module) for "how much GST liability did that filing period
//     actually generate" — never recomputes GST from Bills itself.
//   - Payroll outflow: a simple sum of active staff salaries (per the task
//     spec, a full payroll-run simulation is a separate module's job).
//   - Inflow: a trailing-30-day average daily revenue × horizon days, from
//     real paid Bills. NOTE on reuse: the Forecast module's own revenue
//     projection (generateForecastService's "revenue" KPI) would be a
//     strictly better inflow estimate, and forecast.service.ts's cashFlow
//     KPI wiring DOES use it directly — but importing generateForecastService
//     from here would make forecast.service.ts and cashflow.service.ts
//     require() each other (forecast needs this module's outflow figure for
//     its cashFlow KPI; this module would need forecast's revenue figure for
//     inflow), a circular dependency. So outflow is exposed as its own
//     standalone function (getCashOutflowProjectionService) that
//     forecast.service.ts imports one-directionally and combines with its
//     own already-computed revenue prediction; this module's public
//     getCashFlowProjectionService (used by the /cashflow API for a
//     standalone view) uses the trailing-average fallback for inflow
//     instead, keeping the dependency graph one-way.
import prisma from "../../config/prisma";
import { getPaymentCalendarService, PaymentCalendarEntry } from "../dues/dues.service";
import { computeNextGstFilingDueDate } from "../compliance/compliance.service";
import { getGstFilingReportService } from "../reports/reports.service";

export type CashFlowHorizon = "week" | "month" | "quarter";

const HORIZON_DAYS: Record<CashFlowHorizon, number> = { week: 7, month: 30, quarter: 90 };

const addDays = (date: Date, days: number): Date => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

/** Today at 00:00:00 through today+horizonDays at 23:59:59.999 — shared by both the projection and its outflow half so callers see one consistent window. */
export const resolveCashFlowRange = (horizon: CashFlowHorizon): { fromDate: Date; toDate: Date } => {
  const fromDate = new Date();
  fromDate.setHours(0, 0, 0, 0);
  const toDate = addDays(fromDate, HORIZON_DAYS[horizon]);
  toDate.setHours(23, 59, 59, 999);
  return { fromDate, toDate };
};

// ── Inflow ────────────────────────────────────────────────────────────────────

/** Trailing-30-day average daily revenue × horizon days — see file header for why this (rather than the Forecast Engine) is the inflow source for the standalone Cash Flow Predictor endpoint. */
const projectInflow = async (restaurantId: number, branchId: number, horizon: CashFlowHorizon): Promise<number> => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const agg = await prisma.bill.aggregate({
    where: { restaurantId, branchId, status: "PAID", createdAt: { gte: thirtyDaysAgo } },
    _sum: { total: true },
  });

  const avgDaily = (agg._sum.total ?? 0) / 30;
  return Math.round(avgDaily * HORIZON_DAYS[horizon]);
};

// ── Outflow ───────────────────────────────────────────────────────────────────

/**
 * If a GST_FILING record's next due date falls inside [fromDate, toDate],
 * estimates the payment amount from the actual GST liability of the filing
 * period it covers (GSTR-3B due on the 20th reports the PRIOR calendar
 * month's outward supply), via the existing GST Filing Report — not a fresh
 * GST computation. Returns 0 if no filing is due in range (including
 * branches with no GST_FILING compliance record at all).
 */
const estimateUpcomingGst = async (
  restaurantId: number,
  branchId: number,
  gstRecords: { nextDueDate: Date | null }[],
  fromDate: Date,
  toDate: Date,
): Promise<number> => {
  // Mirrors getComplianceRecordsService's staleness handling: a stored
  // nextDueDate that has already passed is rolled forward to the next
  // filing date the same way, rather than being treated as "nothing due".
  const dueDates = gstRecords.map((r) =>
    !r.nextDueDate || r.nextDueDate.getTime() < Date.now() ? computeNextGstFilingDueDate(new Date()) : r.nextDueDate,
  );
  const dueDate = dueDates.find((d) => d >= fromDate && d <= toDate);
  if (!dueDate) return 0;

  const periodAnchor = new Date(dueDate.getFullYear(), dueDate.getMonth() - 1, 1);
  const periodStart = new Date(periodAnchor.getFullYear(), periodAnchor.getMonth(), 1);
  const periodEnd = new Date(periodAnchor.getFullYear(), periodAnchor.getMonth() + 1, 0);

  const report = await getGstFilingReportService(
    restaurantId,
    branchId,
    periodStart.toISOString().slice(0, 10),
    periodEnd.toISOString().slice(0, 10),
  );
  return report.grandTotal.totalTax;
};

export interface CashOutflowProjection {
  horizon: CashFlowHorizon;
  fromDate: string;
  toDate: string;
  vendorDues: number;
  emiDues: number;
  payroll: number;
  gst: number;
  total: number;
  breakdown: {
    vendorInvoicesDue: PaymentCalendarEntry[];
    emiSchedulesDue: PaymentCalendarEntry[];
  };
}

/**
 * The outflow half of the Cash Flow Predictor, standalone so
 * forecast.service.ts can import it directly (one-directional dependency)
 * and combine it with the Forecast Engine's own revenue prediction for the
 * cashFlow KPI, instead of this module needing to import generateForecastService
 * back (which would create a require() cycle — see file header).
 */
export const getCashOutflowProjectionService = async (
  restaurantId: number,
  branchId: number,
  horizon: CashFlowHorizon = "month",
): Promise<CashOutflowProjection> => {
  const { fromDate, toDate } = resolveCashFlowRange(horizon);

  const [calendar, activeStaff, gstRecords] = await Promise.all([
    // Reuses the dues module's already-merged payment calendar (MonthlyDue +
    // VendorInvoice + EmiSchedule) instead of re-querying VendorInvoice/
    // EmiSchedule separately here — see getPaymentCalendarService for why
    // EMI is fetched restaurant-wide internally and filtered to this branch.
    getPaymentCalendarService(restaurantId, branchId, fromDate, toDate),
    prisma.user.findMany({
      where: { restaurantId, branchId, isActive: true, isDeleted: false },
      select: { salary: true },
    }),
    prisma.complianceRecord.findMany({
      where: { restaurantId, branchId, type: "GST_FILING" },
      select: { nextDueDate: true },
    }),
  ]);

  const vendorInvoicesDue = calendar.filter((e) => e.source === "VENDOR_INVOICE");
  const emiSchedulesDue = calendar.filter((e) => e.source === "EMI");

  const vendorDues = vendorInvoicesDue.reduce((sum, e) => sum + e.amount, 0);
  const emiDues = emiSchedulesDue.reduce((sum, e) => sum + e.amount, 0);

  const totalMonthlySalary = activeStaff.reduce((sum, u) => sum + (u.salary ?? 0), 0);
  // Prorated per the task spec: a week is ~4.3 weeks/month, a quarter is 3
  // months of payroll, a month is the baseline as-is.
  const payroll =
    horizon === "week" ? totalMonthlySalary / 4.3 : horizon === "month" ? totalMonthlySalary : totalMonthlySalary * 3;

  const gst = await estimateUpcomingGst(restaurantId, branchId, gstRecords, fromDate, toDate);

  const total = vendorDues + emiDues + payroll + gst;

  return {
    horizon,
    fromDate: fromDate.toISOString(),
    toDate: toDate.toISOString(),
    vendorDues: Math.round(vendorDues),
    emiDues: Math.round(emiDues),
    payroll: Math.round(payroll),
    gst: Math.round(gst),
    total: Math.round(total),
    breakdown: { vendorInvoicesDue, emiSchedulesDue },
  };
};

// ── Projection (inflow + outflow combined) ────────────────────────────────────

export interface CashFlowProjection {
  horizon: CashFlowHorizon;
  fromDate: string;
  toDate: string;
  projectedInflow: number;
  projectedOutflow: {
    vendorDues: number;
    emiDues: number;
    payroll: number;
    gst: number;
    total: number;
  };
  netCashFlow: number;
  breakdown: {
    vendorInvoicesDue: PaymentCalendarEntry[];
    emiSchedulesDue: PaymentCalendarEntry[];
  };
}

export const getCashFlowProjectionService = async (
  restaurantId: number,
  branchId: number,
  horizon: CashFlowHorizon = "month",
): Promise<CashFlowProjection> => {
  const [projectedInflow, outflow] = await Promise.all([
    projectInflow(restaurantId, branchId, horizon),
    getCashOutflowProjectionService(restaurantId, branchId, horizon),
  ]);

  return {
    horizon,
    fromDate: outflow.fromDate,
    toDate: outflow.toDate,
    projectedInflow,
    projectedOutflow: {
      vendorDues: outflow.vendorDues,
      emiDues: outflow.emiDues,
      payroll: outflow.payroll,
      gst: outflow.gst,
      total: outflow.total,
    },
    netCashFlow: Math.round(projectedInflow - outflow.total),
    breakdown: outflow.breakdown,
  };
};

// ── Daily inflow trend ────────────────────────────────────────────────────────

export interface DailyCashInflow {
  date: string;
  revenue: number;
  billCount: number;
}

/**
 * Daily revenue trend for an arbitrary date range, from paid Bills. Reuses
 * the same "bucket rows by ISO date string" grouping getRevenueForecastService
 * (analyticsAdvanced.service.ts) already uses for its rolling daily trend,
 * rather than inventing a second day-bucketing approach — extended here to
 * also carry a per-day bill count and to fill in zero-revenue gap days.
 */
export const getDailyCashInflowService = async (
  restaurantId: number,
  branchId: number,
  from: string,
  to: string,
): Promise<DailyCashInflow[]> => {
  const fromDate = new Date(from);
  const toDate = new Date(to + "T23:59:59.999Z");

  const bills = await prisma.bill.findMany({
    where: { restaurantId, branchId, status: "PAID", createdAt: { gte: fromDate, lte: toDate } },
    select: { total: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const byDate: Record<string, { revenue: number; billCount: number }> = {};
  bills.forEach((b) => {
    const key = new Date(b.createdAt).toISOString().slice(0, 10);
    if (!byDate[key]) byDate[key] = { revenue: 0, billCount: 0 };
    byDate[key].revenue += b.total;
    byDate[key].billCount += 1;
  });

  const days: DailyCashInflow[] = [];
  const cursor = new Date(fromDate);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setHours(0, 0, 0, 0);
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    const bucket = byDate[key];
    days.push({ date: key, revenue: Math.round(bucket?.revenue ?? 0), billCount: bucket?.billCount ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
};
