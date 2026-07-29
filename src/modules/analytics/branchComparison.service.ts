import prisma from "../../config/prisma";
import { fetchInsightsForScope, getMenuItemCostMap, getPayrollPolicyMap, resolveScopedMetrics } from "../finance/finance.service";
import { DateRange } from "../../utils/dateRange";

const toNum = (v: any) => Number(v) || 0;

const buildDateFilter = (from?: string, to?: string) =>
  from && to
    ? { createdAt: { gte: new Date(from), lte: new Date(to + "T23:59:59.999Z") } }
    : {};

// Same fallback window (30 days) the old local daysInRange used — kept only
// for the from/to-missing edge case; resolveScopedMetrics always needs a
// concrete DateRange (unlike this file's own operational queries below,
// which can run with an empty/all-time filter).
const toDateRange = (from?: string, to?: string): DateRange => {
  if (from && to) return { startDate: new Date(from), endDate: new Date(to + "T23:59:59.999Z") };
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 30);
  return { startDate, endDate };
};

// ─── Per-branch data aggregation ─────────────────────────────────────────────

export const getBranchComparisonService = async (
  restaurantId: number,
  from?: string,
  to?: string,
) => {
  const dateFilter = buildDateFilter(from, to);
  const paidFilter = { status: "PAID" as const };
  const range = toDateRange(from, to);

  const [
    branches,
    billStats,
    orderTypeBreakdown,
    paymentBreakdown,
    staffStats,
    customerBreakdown,
  ] = await Promise.all([
    prisma.branch.findMany({
      where: { restaurantId, isDeleted: false },
      select: { id: true, name: true, city: true, state: true },
      orderBy: { name: "asc" },
    }),
    prisma.bill.groupBy({
      by: ["branchId"],
      where: { restaurantId, ...dateFilter, ...paidFilter },
      _sum: { total: true, discount: true, cgst: true, sgst: true },
      _count: { id: true },
      _avg: { total: true },
    }),
    prisma.bill.groupBy({
      by: ["branchId", "orderType"],
      where: { restaurantId, ...dateFilter, ...paidFilter },
      _count: { id: true },
      _sum: { total: true },
    }),
    prisma.bill.groupBy({
      by: ["branchId", "paymentMethod"],
      where: { restaurantId, ...dateFilter, ...paidFilter },
      _count: { id: true },
      _sum: { total: true },
    }),
    prisma.user.groupBy({
      by: ["branchId"],
      where: { restaurantId, branchId: { not: null }, isDeleted: false },
      _count: { id: true },
    }),
    prisma.bill.groupBy({
      by: ["branchId", "customerId"],
      where: {
        restaurantId,
        ...dateFilter,
        ...paidFilter,
        customerId: { not: null },
      },
      _count: { id: true },
    }),
  ]);

  // Top 5 items per branch — one query per branch, bounded by branch count.
  const [topItemsByBranch, menuItemCostMap, payrollPolicyMap] = await Promise.all([
    Promise.all(
      branches.map(async (branch) => {
        const items = await prisma.billItem.groupBy({
          by: ["itemName"],
          where: {
            bill: { branchId: branch.id, restaurantId, ...dateFilter, ...paidFilter },
          },
          _sum: { quantity: true, total: true },
          orderBy: { _sum: { quantity: "desc" } },
          take: 5,
        });
        return { branchId: branch.id, items };
      }),
    ),
    getMenuItemCostMap(restaurantId),
    getPayrollPolicyMap(restaurantId),
  ]);

  // Revenue, Food Cost, Labour Cost, Prime Cost, EBITDA, and Net Profit are
  // now sourced from the same Finance Engine (resolveScopedMetrics) every
  // other financial screen uses — previously this file summed real
  // ShopExpense transactions for opex (a different data source than the
  // RestaurantInsights-prorated assumptions the Finance Engine uses
  // everywhere else) and labeled the resulting EBITDA-equivalent figure
  // "Net Profit" with no finance cost subtracted. Both bugs are fixed by
  // routing through resolveScopedMetrics per branch, exactly as Executive
  // Dashboard's Multi-Branch view already does.
  const financialsByBranch = new Map(
    await Promise.all(
      branches.map(async (branch) => {
        const insights = await fetchInsightsForScope(restaurantId, branch.id);
        const bundle = await resolveScopedMetrics(restaurantId, branch.id, range, menuItemCostMap, insights, payrollPolicyMap);
        return [branch.id, bundle] as const;
      }),
    ),
  );

  return branches.map((branch) => {
    const bills = billStats.find((b) => b.branchId === branch.id);
    const staff = staffStats.find((s) => s.branchId === branch.id);
    const orderTypes = orderTypeBreakdown.filter((o) => o.branchId === branch.id);
    const payments = paymentBreakdown.filter((p) => p.branchId === branch.id);
    const topItems =
      topItemsByBranch.find((t) => t.branchId === branch.id)?.items || [];
    const customerRows = customerBreakdown.filter((c) => c.branchId === branch.id);
    const { metrics } = financialsByBranch.get(branch.id)!;

    const discount = toNum(bills?._sum.discount);
    const gst = toNum(bills?._sum.cgst) + toNum(bills?._sum.sgst);
    const totalCustomers = customerRows.length;
    const repeatCustomers = customerRows.filter((c) => c._count.id > 1).length;

    return {
      branch,
      revenue: metrics.revenue,
      orders: metrics.orders,
      avgBill: Math.round(metrics.avgOrderValue),
      discount,
      gst,
      expenses: metrics.fixedExpenses + metrics.variableExpenses,
      foodCost: metrics.foodCost,
      foodCostPercentage: metrics.foodCostPercentage,
      labourCost: metrics.labourCost,
      labourCostPercentage: metrics.labourCostPercentage,
      primeCost: metrics.primeCost,
      primeCostPercentage: metrics.primeCostPercentage,
      ebitda: metrics.ebitda,
      netProfit: metrics.netProfit,
      staffCount: staff?._count.id || 0,
      revenuePerEmployee:
        (staff?._count.id || 0) > 0
          ? Math.round(metrics.revenue / (staff?._count.id || 1))
          : 0,
      totalCustomers,
      repeatCustomers,
      repeatCustomerRate:
        totalCustomers > 0
          ? Math.round((repeatCustomers / totalCustomers) * 100)
          : 0,
      orderTypes: orderTypes.map((o) => ({
        type: o.orderType,
        count: o._count.id,
        revenue: toNum(o._sum.total),
      })),
      payments: payments.map((p) => ({
        method: p.paymentMethod,
        count: p._count.id,
        revenue: toNum(p._sum.total),
      })),
      topItems: topItems.map((item) => ({
        name: item.itemName,
        quantity: toNum(item._sum.quantity),
        revenue: toNum(item._sum.total),
      })),
    };
  });
};

// ─── City-level aggregation (groups branches by city) ────────────────────────

export const getCityComparisonService = async (
  restaurantId: number,
  from?: string,
  to?: string,
) => {
  const branchData = await getBranchComparisonService(restaurantId, from, to);
  const dateFilter = buildDateFilter(from, to);

  // Group branches by city up front so customer counts can be computed with
  // one dedicated query per city — summing each branch's customer counts
  // would double-count anyone who visited more than one branch in the city.
  const branchIdsByCity: Record<string, number[]> = {};
  for (const bd of branchData) {
    const city = bd.branch.city?.trim() || "Unknown";
    (branchIdsByCity[city] ||= []).push(bd.branch.id);
  }

  const customersByCity = await Promise.all(
    Object.entries(branchIdsByCity).map(async ([city, branchIds]) => {
      const rows = await prisma.bill.groupBy({
        by: ["customerId"],
        where: {
          restaurantId,
          branchId: { in: branchIds },
          ...dateFilter,
          status: "PAID",
          customerId: { not: null },
        },
        _count: { id: true },
      });
      return {
        city,
        totalCustomers: rows.length,
        repeatCustomers: rows.filter((r) => r._count.id > 1).length,
      };
    }),
  );
  const customersMapByCity = Object.fromEntries(
    customersByCity.map((c) => [c.city, c]),
  );

  type CityAgg = {
    city: string;
    branches: { id: number; name: string }[];
    revenue: number;
    orders: number;
    discount: number;
    gst: number;
    expenses: number;
    labourCost: number;
    ebitda: number;
    netProfit: number;
    staffCount: number;
    orderTypes: Record<string, { count: number; revenue: number }>;
    payments: Record<string, { count: number; revenue: number }>;
    topItems: Record<string, { quantity: number; revenue: number }>;
  };

  const cityMap: Record<string, CityAgg> = {};

  for (const bd of branchData) {
    const city = bd.branch.city?.trim() || "Unknown";
    if (!cityMap[city]) {
      cityMap[city] = {
        city,
        branches: [],
        revenue: 0,
        orders: 0,
        discount: 0,
        gst: 0,
        expenses: 0,
        labourCost: 0,
        ebitda: 0,
        netProfit: 0,
        staffCount: 0,
        orderTypes: {},
        payments: {},
        topItems: {},
      };
    }
    const c = cityMap[city];
    c.branches.push({ id: bd.branch.id, name: bd.branch.name });
    c.revenue += bd.revenue;
    c.orders += bd.orders;
    c.discount += bd.discount;
    c.gst += bd.gst;
    c.expenses += bd.expenses;
    c.labourCost += bd.labourCost;
    c.ebitda += bd.ebitda;
    c.netProfit += bd.netProfit;
    c.staffCount += bd.staffCount;

    for (const ot of bd.orderTypes) {
      if (!c.orderTypes[ot.type]) c.orderTypes[ot.type] = { count: 0, revenue: 0 };
      c.orderTypes[ot.type].count += ot.count;
      c.orderTypes[ot.type].revenue += ot.revenue;
    }
    for (const p of bd.payments) {
      if (!c.payments[p.method]) c.payments[p.method] = { count: 0, revenue: 0 };
      c.payments[p.method].count += p.count;
      c.payments[p.method].revenue += p.revenue;
    }
    for (const item of bd.topItems) {
      if (!c.topItems[item.name]) c.topItems[item.name] = { quantity: 0, revenue: 0 };
      c.topItems[item.name].quantity += item.quantity;
      c.topItems[item.name].revenue += item.revenue;
    }
  }

  return Object.values(cityMap).map((c) => {
    const customers = customersMapByCity[c.city] || {
      totalCustomers: 0,
      repeatCustomers: 0,
    };
    return {
      city: c.city,
      branches: c.branches,
      revenue: c.revenue,
      orders: c.orders,
      avgBill: c.orders > 0 ? Math.round(c.revenue / c.orders) : 0,
      discount: c.discount,
      gst: c.gst,
      expenses: c.expenses,
      labourCost: c.labourCost,
      labourCostPercentage:
        c.revenue > 0 ? Math.round((c.labourCost / c.revenue) * 1000) / 10 : 0,
      ebitda: c.ebitda,
      netProfit: c.netProfit,
      staffCount: c.staffCount,
      revenuePerEmployee:
        c.staffCount > 0 ? Math.round(c.revenue / c.staffCount) : 0,
      totalCustomers: customers.totalCustomers,
      repeatCustomers: customers.repeatCustomers,
      repeatCustomerRate:
        customers.totalCustomers > 0
          ? Math.round((customers.repeatCustomers / customers.totalCustomers) * 100)
          : 0,
      orderTypes: Object.entries(c.orderTypes).map(([type, d]) => ({ type, ...d })),
      payments: Object.entries(c.payments).map(([method, d]) => ({ method, ...d })),
      topItems: Object.entries(c.topItems)
        .map(([name, d]) => ({ name, ...d }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 5),
    };
  });
};
