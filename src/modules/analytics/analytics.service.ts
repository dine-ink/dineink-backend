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
  const revenueByOrderType: Record<string, number> = {};
  const ordersByOrderType: Record<string, number> = {};

  for (const bill of bills) {
    const hour = new Date(bill.createdAt).getHours();
    if (!hourlyAnalytics[hour]) hourlyAnalytics[hour] = { orders: 0, revenue: 0 };
    hourlyAnalytics[hour].orders += 1;
    hourlyAnalytics[hour].revenue += bill.total;

    if (bill.customerId) {
      customerOrdersMap[bill.customerId] = (customerOrdersMap[bill.customerId] || 0) + 1;
    }

    paymentMap[bill.paymentMethod] = (paymentMap[bill.paymentMethod] || 0) + bill.total;

    const orderType = bill.orderType || "UNKNOWN";
    revenueByOrderType[orderType] = (revenueByOrderType[orderType] || 0) + bill.total;
    ordersByOrderType[orderType] = (ordersByOrderType[orderType] || 0) + 1;

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
    revenueByOrderType,
    ordersByOrderType,
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

  const billWhere = {
    restaurantId,
    ...branchFilter,
    status: "PAID" as const,
    createdAt: { gte: startDate, lte: endDate },
  };

  const [bills, occupiedTables, branches, menuItemsWithCategory, newCustomersCount, cancelledStats] = await Promise.all([
    prisma.bill.findMany({
      where: billWhere,
      select: billSelect,
      orderBy: { createdAt: "desc" },
    }),
    prisma.restaurantTable.count({
      where: { restaurantId, ...branchFilter, status: "OCCUPIED" },
    }),
    prisma.branch.count({ where: { restaurantId } }),
    prisma.menuItem.findMany({
      where: { restaurantId, isDeleted: false },
      select: { name: true, category: { select: { name: true } } },
    }),
    // A Customer row is only ever created (never just updated) the first
    // time a phone number is seen (see closeRunningOrderService's upsert),
    // so its createdAt is an accurate "first purchase" timestamp — this
    // count is restaurant-wide (Customer has no branchId), used for CAC.
    prisma.customer.count({
      where: { restaurantId, createdAt: { gte: startDate, lte: endDate } },
    }),
    // There's no separate refund record — CANCELLED bills are the closest
    // proxy for "money given back", used to approximate Refund %.
    prisma.bill.aggregate({
      where: {
        restaurantId,
        ...branchFilter,
        status: "CANCELLED",
        createdAt: { gte: startDate, lte: endDate },
      },
      _sum: { total: true },
      _count: { id: true },
    }),
  ]);

  // Build name → category lookup (case-insensitive) from menu items
  const itemToCategoryMap = new Map<string, string>(
    menuItemsWithCategory.map((mi) => [
      mi.name.toLowerCase(),
      mi.category?.name || "Uncategorized",
    ]),
  );

  // Aggregate by category using itemName on BillItem — works even when menuItemId is null
  const categoryMap: Record<string, number> = {};
  for (const bill of bills) {
    for (const item of (bill as any).items || []) {
      const cat = itemToCategoryMap.get(item.itemName?.toLowerCase()) || "Uncategorized";
      categoryMap[cat] = (categoryMap[cat] || 0) + item.quantity;
    }
  }
  const topCategories = Object.entries(categoryMap)
    .filter(([name]) => name !== "Uncategorized")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, quantity]) => ({ name, quantity }));

  const aggregated = aggregateBills(bills);

  const result = {
    ...aggregated,
    topCategories,
    occupiedTables,
    branches,
    newCustomersCount,
    cancelledTotal: cancelledStats._sum.total || 0,
    cancelledCount: cancelledStats._count.id || 0,
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

// Insights fixed/variable/labour costs are monthly figures (re-entered each
// month in Insights Setup), so "revenue" here must be scoped to the current
// calendar month too — an all-time sum would dwarf one month of costs and
// make EBITDA%/food-cost%/prime-cost% look better the longer the restaurant
// has been open, regardless of actual performance.
const currentMonthRange = () => {
  const now = new Date();
  return { gte: new Date(now.getFullYear(), now.getMonth(), 1), lte: now };
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
      where: {
        restaurantId,
        branchId,
        status: "PAID",
        createdAt: currentMonthRange(),
      },
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
      where: { restaurantId, status: "PAID", createdAt: currentMonthRange() },
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

const parseHHMM = (t?: string | null) => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h)) return null;
  return h + (m || 0) / 60;
};

// ─── getTableOperationsService (Table Turnover Rate + Seat Utilization) ───────
export const getTableOperationsService = async (
  restaurantId: number,
  branchId: number,
  from?: string,
  to?: string,
) => {
  const { startDate, endDate } = getDateRange("month", from, to);

  const [tables, branch, closedOrders] = await Promise.all([
    prisma.restaurantTable.findMany({
      where: { restaurantId, branchId, isTemporary: false },
      select: { id: true, capacity: true },
    }),
    prisma.branch.findUnique({
      where: { id: branchId },
      select: { openingTime: true, closingTime: true },
    }),
    // status flips to "CLOSED" only when the bill is settled and the table is
    // freed (see closeRunningOrderService) — updatedAt is that closure
    // moment, since completedAt is only ever set by the kitchen-ready flow.
    prisma.runningOrder.findMany({
      where: {
        restaurantId,
        branchId,
        status: "CLOSED",
        tableId: { not: null },
        updatedAt: { gte: startDate, lte: endDate },
      },
      select: { tableId: true, startedAt: true, updatedAt: true },
    }),
  ]);

  const totalTables = tables.length;
  const totalCapacity = tables.reduce((s, t) => s + (t.capacity || 0), 0);
  const tablesWithMissingCapacity = tables.filter((t) => !t.capacity).length;
  const periodDays = Math.max(
    1,
    Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1,
  );

  const openHour = parseHHMM(branch?.openingTime);
  const closeHour = parseHHMM(branch?.closingTime);
  const hasOperatingHours =
    openHour !== null && closeHour !== null && closeHour > openHour;
  // Default to a 12-hour operating day when the branch hasn't configured hours.
  const operatingHoursPerDay = hasOperatingHours ? closeHour! - openHour! : 12;

  const turnoverCount = closedOrders.length;
  const tableTurnoverRate = totalTables > 0 ? turnoverCount / totalTables : 0;
  const turnsPerTablePerDay =
    totalTables > 0 ? turnoverCount / totalTables / periodDays : 0;

  // Seat Utilization approximates occupied seats as the table's full
  // capacity for its occupied duration — guest headcount per bill isn't
  // tracked, so this is a time-occupancy proxy, not a true covers-based
  // seat-utilization figure.
  const capacityByTable = new Map(tables.map((t) => [t.id, t.capacity || 0]));
  let occupiedSeatHours = 0;
  for (const o of closedOrders) {
    const hours =
      (new Date(o.updatedAt).getTime() - new Date(o.startedAt).getTime()) /
      3_600_000;
    if (hours <= 0 || hours > 12) continue; // guard against bad/anomalous sessions
    occupiedSeatHours += hours * (capacityByTable.get(o.tableId!) || 0);
  }
  const availableSeatHours = totalCapacity * operatingHoursPerDay * periodDays;
  const seatUtilizationPercentage =
    availableSeatHours > 0
      ? Math.min(100, (occupiedSeatHours / availableSeatHours) * 100)
      : 0;

  return {
    totalTables,
    totalCapacity,
    tablesWithMissingCapacity,
    periodDays,
    operatingHoursPerDay,
    hasOperatingHours,
    turnoverCount,
    tableTurnoverRate,
    turnsPerTablePerDay,
    seatUtilizationPercentage,
  };
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
