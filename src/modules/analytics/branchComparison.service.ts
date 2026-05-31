import prisma from "../../config/prisma";

const toNum = (v: any) => Number(v) || 0;

const buildDateFilter = (from?: string, to?: string) =>
  from && to
    ? { createdAt: { gte: new Date(from), lte: new Date(to + "T23:59:59.999Z") } }
    : {};

// ─── Per-branch data aggregation ─────────────────────────────────────────────

export const getBranchComparisonService = async (
  restaurantId: number,
  from?: string,
  to?: string,
) => {
  const dateFilter = buildDateFilter(from, to);

  const [
    branches,
    billStats,
    orderTypeBreakdown,
    paymentBreakdown,
    expenseStats,
    staffStats,
  ] = await Promise.all([
    prisma.branch.findMany({
      where: { restaurantId, isDeleted: false },
      select: { id: true, name: true, city: true, state: true },
      orderBy: { name: "asc" },
    }),
    prisma.bill.groupBy({
      by: ["branchId"],
      where: { restaurantId, ...dateFilter },
      _sum: { total: true, discount: true, cgst: true, sgst: true },
      _count: { id: true },
      _avg: { total: true },
    }),
    prisma.bill.groupBy({
      by: ["branchId", "orderType"],
      where: { restaurantId, ...dateFilter },
      _count: { id: true },
      _sum: { total: true },
    }),
    prisma.bill.groupBy({
      by: ["branchId", "paymentMethod"],
      where: { restaurantId, ...dateFilter },
      _count: { id: true },
      _sum: { total: true },
    }),
    prisma.shopExpense.groupBy({
      by: ["branchId"],
      where: { restaurantId, ...dateFilter },
      _sum: { amount: true },
    }),
    prisma.user.groupBy({
      by: ["branchId"],
      where: { restaurantId, branchId: { not: null } },
      _count: { id: true },
    }),
  ]);

  // Top 5 items per branch — one query per branch (bounded by branch count)
  const topItemsByBranch = await Promise.all(
    branches.map(async (branch) => {
      const items = await prisma.billItem.groupBy({
        by: ["itemName"],
        where: { bill: { branchId: branch.id, restaurantId, ...dateFilter } },
        _sum: { quantity: true, total: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 5,
      });
      return { branchId: branch.id, items };
    }),
  );

  return branches.map((branch) => {
    const bills = billStats.find((b) => b.branchId === branch.id);
    const expenses = expenseStats.find((e) => e.branchId === branch.id);
    const staff = staffStats.find((s) => s.branchId === branch.id);
    const orderTypes = orderTypeBreakdown.filter((o) => o.branchId === branch.id);
    const payments = paymentBreakdown.filter((p) => p.branchId === branch.id);
    const topItems =
      topItemsByBranch.find((t) => t.branchId === branch.id)?.items || [];

    const revenue = toNum(bills?._sum.total);
    const discount = toNum(bills?._sum.discount);
    const gst = toNum(bills?._sum.cgst) + toNum(bills?._sum.sgst);
    const expenseTotal = toNum(expenses?._sum.amount);
    const netProfit = revenue - gst - expenseTotal;
    const orders = bills?._count.id || 0;

    return {
      branch,
      revenue,
      orders,
      avgBill: orders > 0 ? Math.round(toNum(bills?._avg.total)) : 0,
      discount,
      gst,
      expenses: expenseTotal,
      netProfit,
      staffCount: staff?._count.id || 0,
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

  type CityAgg = {
    city: string;
    branches: { id: number; name: string }[];
    revenue: number;
    orders: number;
    discount: number;
    gst: number;
    expenses: number;
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

  return Object.values(cityMap).map((c) => ({
    city: c.city,
    branches: c.branches,
    revenue: c.revenue,
    orders: c.orders,
    avgBill: c.orders > 0 ? Math.round(c.revenue / c.orders) : 0,
    discount: c.discount,
    gst: c.gst,
    expenses: c.expenses,
    netProfit: c.netProfit,
    staffCount: c.staffCount,
    orderTypes: Object.entries(c.orderTypes).map(([type, d]) => ({ type, ...d })),
    payments: Object.entries(c.payments).map(([method, d]) => ({ method, ...d })),
    topItems: Object.entries(c.topItems)
      .map(([name, d]) => ({ name, ...d }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5),
  }));
};
