import prisma from "../../config/prisma";

// ─── In-memory TTL cache for analytics ───────────────────────────────────────
const cache = new Map<string, { data: any; expiresAt: number }>();

function getCached(key: string) {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data;
  cache.delete(key);
  return null;
}

function setCached(key: string, data: any, ttlMs = 60_000) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export function invalidateDashboardCache(restaurantId: number) {
  for (const key of cache.keys()) {
    if (key.startsWith(`dashboard:${restaurantId}:`)) cache.delete(key);
  }
}

// Shared select shape — enough for both analytics aggregation and the recent-orders response
const billSelect = {
  id: true,
  billNo: true,
  total: true,
  subtotal: true,
  gst: true,
  cgst: true,
  sgst: true,
  discount: true,
  serviceCharge: true,
  packingCharge: true,
  status: true,
  orderStatus: true,
  orderType: true,
  paymentMethod: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  restaurantId: true,
  branchId: true,
  customerId: true,
  createdById: true,
  customer: true,
  items: true,
};

function getDateRange(
  range: string,
  from?: string,
  to?: string,
): { startDate: Date; endDate: Date } {
  let startDate = new Date();
  let endDate = new Date();
  endDate.setHours(23, 59, 59, 999);

  // Always prefer explicit from/to when provided (frontend computes rolling windows)
  if (from && to) {
    startDate = new Date(from);
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(to);
    endDate.setHours(23, 59, 59, 999);
    return { startDate, endDate };
  }

  // Fallback when no from/to supplied
  switch (range) {
    case "today":
      startDate.setHours(0, 0, 0, 0);
      break;
    case "week":
      startDate.setDate(startDate.getDate() - 6);
      break;
    case "month":
      startDate.setDate(startDate.getDate() - 29);
      break;
    case "quarter":
      startDate.setDate(startDate.getDate() - 89);
      break;
    default:
      startDate.setHours(0, 0, 0, 0);
  }

  return { startDate, endDate };
}

function formatHour(hour: number) {
  const startHour = hour % 12 || 12;
  const endHour = (hour + 1) % 12 || 12;
  const startPeriod = hour >= 12 ? "PM" : "AM";
  const endPeriod = hour + 1 >= 12 && hour + 1 < 24 ? "PM" : "AM";
  return `${startHour} ${startPeriod} - ${endHour} ${endPeriod}`;
}

function aggregateBills(bills: any[]) {
  const hourlyAnalytics: Record<number, { orders: number; revenue: number }> = {};
  const customerOrdersMap: Record<number, number> = {};
  const paymentMap: Record<string, number> = {};
  const itemMap: Record<string, number> = {};
  const revenueByDate: Record<string, number> = {};
  const ordersByDate: Record<string, number> = {};

  for (const bill of bills) {
    const hour = new Date(bill.createdAt).getHours();
    if (!hourlyAnalytics[hour]) hourlyAnalytics[hour] = { orders: 0, revenue: 0 };
    hourlyAnalytics[hour].orders += 1;
    hourlyAnalytics[hour].revenue += bill.total;

    if (bill.customerId) {
      customerOrdersMap[bill.customerId] = (customerOrdersMap[bill.customerId] || 0) + 1;
    }

    paymentMap[bill.paymentMethod] = (paymentMap[bill.paymentMethod] || 0) + bill.total;

    for (const item of bill.items) {
      itemMap[item.itemName] = (itemMap[item.itemName] || 0) + item.quantity;
    }

    const date = new Date(bill.createdAt).toISOString().slice(0, 10);
    revenueByDate[date] = (revenueByDate[date] || 0) + bill.total;
    ordersByDate[date] = (ordersByDate[date] || 0) + 1;
  }

  const totalRevenue = bills.reduce((sum, b) => sum + b.total, 0);
  const totalOrders = bills.length;
  const avgOrderValue = totalOrders ? totalRevenue / totalOrders : 0;
  const totalCustomers = Object.keys(customerOrdersMap).length;
  const repeatCustomersCount = Object.values(customerOrdersMap).filter((c) => c > 1).length;

  const topItems = Object.entries(itemMap)
    .sort((a: any, b: any) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, quantity]) => ({ name, quantity }));

  let peakHour = 0;
  let peakOrders = 0;
  for (const [hour, data] of Object.entries(hourlyAnalytics)) {
    if (data.orders > peakOrders) {
      peakOrders = data.orders;
      peakHour = Number(hour);
    }
  }

  return {
    totalRevenue,
    totalOrders,
    avgOrderValue,
    totalCustomers,
    repeatCustomersCount,
    topItems,
    paymentSplit: paymentMap,
    revenueByDate,
    ordersByDate,
    hourlyAnalytics,
    peakHours: formatHour(peakHour),
  };
}

// ─── getDashboardOverviewService ─────────────────────────────────────────────
export const getDashboardOverviewService = async (
  restaurantId: number,
  branchId?: number | null,
  range = "today",
  from?: string,
  to?: string,
) => {
  const cacheKey = `dashboard:${restaurantId}:${branchId ?? "all"}:${range}:${from ?? ""}:${to ?? ""}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const { startDate, endDate } = getDateRange(range, from, to);
  const branchFilter = branchId ? { branchId } : {};

  const [bills, occupiedTables, branches] = await Promise.all([
    prisma.bill.findMany({
      where: {
        restaurantId,
        ...branchFilter,
        status: "PAID",
        createdAt: { gte: startDate, lte: endDate },
      },
      select: billSelect,
      orderBy: { createdAt: "desc" },
    }),
    prisma.restaurantTable.count({
      where: { restaurantId, ...branchFilter, status: "OCCUPIED" },
    }),
    prisma.branch.count({ where: { restaurantId } }),
  ]);

  const aggregated = aggregateBills(bills);

  const result = {
    ...aggregated,
    occupiedTables,
    branches,
    recentOrders: bills.slice(0, 10),
  };

  setCached(cacheKey, result);
  return result;
};

// ─── saveRestaurantInsightsData ───────────────────────────────────────────────
export const saveRestaurantInsightsData = async (data: any) => {
  const { restaurantId, branchId, revenue, ...rest } = data;

  return prisma.restaurantInsights.upsert({
    where: { restaurantId_branchId: { restaurantId, branchId } },
    update: { ...rest },
    create: { restaurantId, branchId, ...rest },
  });
};

// ─── getBranchInsightsData ────────────────────────────────────────────────────
export const getBranchInsightsData = async (
  restaurantId: number,
  branchId: number,
) => {
  const [insights, sales] = await Promise.all([
    prisma.restaurantInsights.findUnique({
      where: { restaurantId_branchId: { restaurantId, branchId } },
    }),
    prisma.bill.aggregate({
      _sum: { total: true },
      where: { restaurantId, branchId, status: "PAID" },
    }),
  ]);

  return { ...insights, revenue: sales._sum.total || 0 };
};

// ─── getRestaurantInsightsData ────────────────────────────────────────────────
export const getRestaurantInsightsData = async (restaurantId: number) => {
  const [insights, sales] = await Promise.all([
    prisma.restaurantInsights.findMany({ where: { restaurantId } }),
    prisma.bill.aggregate({
      _sum: { total: true },
      where: { restaurantId, status: "PAID" },
    }),
  ]);

  const revenue = sales._sum.total || 0;
  const totals = insights.reduce((acc: any, item: any) => {
    for (const key of Object.keys(item)) {
      if (typeof item[key] === "number") acc[key] = (acc[key] || 0) + item[key];
    }
    return acc;
  }, {});

  return { ...totals, revenue };
};

// ─── getDashboardOverviewDataService (owner/admin view — no restaurant filter) ─
export const getDashboardOverviewDataService = async (range = "today") => {
  const { startDate, endDate } = getDateRange(range);

  const [bills, occupiedTables, branches] = await Promise.all([
    prisma.bill.findMany({
      where: { status: "PAID", createdAt: { gte: startDate, lte: endDate } },
      select: billSelect,
      orderBy: { createdAt: "desc" },
    }),
    prisma.restaurantTable.count({ where: { status: "OCCUPIED" } }),
    prisma.branch.count(),
  ]);

  const aggregated = aggregateBills(bills);

  return {
    ...aggregated,
    occupiedTables,
    branches,
    recentOrders: bills.slice(0, 10),
  };
};
