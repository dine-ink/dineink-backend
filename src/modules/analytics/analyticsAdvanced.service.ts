import prisma from "../../config/prisma";
import { computeOvertimeCost, computeStandardShiftHours } from "../finance/finance.formulas";

const toNum = (v: any) => Number(v) || 0;

const buildDateFilter = (from?: string, to?: string) =>
  from && to
    ? { createdAt: { gte: new Date(from), lte: new Date(new Date(to).setHours(23, 59, 59, 999)) } }
    : {};

const HOUR_LABEL = (h: number) =>
  h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ─── 1. Kitchen Analytics ────────────────────────────────────────────────────

export const getKitchenAnalyticsService = async (
  restaurantId: number,
  branchId?: number,
  from?: string,
  to?: string,
) => {
  const dateFilter = buildDateFilter(from, to);
  const branchFilter = branchId ? { branchId } : {};
  const SLA_MINUTES = 30;

  const orders = await prisma.runningOrder.findMany({
    where: { restaurantId, ...branchFilter, completedAt: { not: null }, ...dateFilter },
    select: {
      id: true,
      startedAt: true,
      completedAt: true,
      orderType: true,
      tableId: true,
      table: { select: { name: true } },
      batches: {
        select: {
          createdAt: true,
          items: { select: { itemName: true, quantity: true, status: true } },
        },
      },
    },
  });

  // Compute durations, filter anomalies (negative or > 5 hours)
  const timed = orders
    .filter((o) => o.completedAt)
    .map((o) => {
      const mins = Math.round(
        (new Date(o.completedAt!).getTime() - new Date(o.startedAt).getTime()) / 60000,
      );
      return {
        ...o,
        mins,
        hour: new Date(o.startedAt).getHours(),
        dateStr: new Date(o.startedAt).toLocaleDateString("en-IN"),
      };
    })
    .filter((o) => o.mins > 0 && o.mins < 300);

  const total = timed.length;
  const avgTime = total ? Math.round(timed.reduce((s, o) => s + o.mins, 0) / total) : 0;
  const slaPercent = total ? Math.round((timed.filter((o) => o.mins <= SLA_MINUTES).length / total) * 100) : 0;
  const fastestOrder = total ? Math.min(...timed.map((o) => o.mins)) : 0;
  const slowestOrderTime = total ? Math.max(...timed.map((o) => o.mins)) : 0;

  // Hourly throughput
  const hourlyMap: Record<number, { count: number; totalMins: number }> = {};
  for (let h = 0; h < 24; h++) hourlyMap[h] = { count: 0, totalMins: 0 };
  timed.forEach((o) => { hourlyMap[o.hour].count++; hourlyMap[o.hour].totalMins += o.mins; });
  const hourlyData = Object.entries(hourlyMap).map(([h, d]) => ({
    hour: Number(h),
    label: HOUR_LABEL(Number(h)),
    orders: d.count,
    avgTime: d.count ? Math.round(d.totalMins / d.count) : 0,
  }));
  const peakHour = hourlyData.reduce((b, h) => (h.orders > b.orders ? h : b), hourlyData[0]);

  // Daily trend
  const dailyMap: Record<string, { orders: number; totalMins: number }> = {};
  timed.forEach((o) => {
    if (!dailyMap[o.dateStr]) dailyMap[o.dateStr] = { orders: 0, totalMins: 0 };
    dailyMap[o.dateStr].orders++;
    dailyMap[o.dateStr].totalMins += o.mins;
  });
  const dailyTrend = Object.entries(dailyMap).map(([date, d]) => ({
    date,
    orders: d.orders,
    avgTime: Math.round(d.totalMins / d.orders),
  }));

  // Table turn times
  const tableMap: Record<number, { name: string; count: number; totalMins: number }> = {};
  timed.filter((o) => o.tableId).forEach((o) => {
    const tid = o.tableId!;
    if (!tableMap[tid]) tableMap[tid] = { name: o.table?.name || `Table ${tid}`, count: 0, totalMins: 0 };
    tableMap[tid].count++;
    tableMap[tid].totalMins += o.mins;
  });
  const tableTurnData = Object.values(tableMap)
    .map((t) => ({ ...t, avgTime: Math.round(t.totalMins / t.count) }))
    .sort((a, b) => b.count - a.count);

  // Top items from kitchen batches
  const itemCounts: Record<string, number> = {};
  orders.forEach((o) => o.batches.forEach((b) => b.items.forEach((i) => {
    itemCounts[i.itemName] = (itemCounts[i.itemName] || 0) + i.quantity;
  })));
  const topItems = Object.entries(itemCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Order type speed breakdown
  const typeMap: Record<string, { count: number; totalMins: number }> = {};
  timed.forEach((o) => {
    const t = o.orderType || "DINE_IN";
    if (!typeMap[t]) typeMap[t] = { count: 0, totalMins: 0 };
    typeMap[t].count++;
    typeMap[t].totalMins += o.mins;
  });
  const orderTypeSpeeds = Object.entries(typeMap).map(([type, d]) => ({
    type,
    count: d.count,
    avgTime: Math.round(d.totalMins / d.count),
  }));

  // Slowest 10 orders for investigation
  const slowestOrders = [...timed]
    .sort((a, b) => b.mins - a.mins)
    .slice(0, 10)
    .map((o) => ({
      id: o.id,
      orderType: o.orderType || "DINE_IN",
      tableName: o.table?.name ?? null,
      durationMinutes: o.mins,
      startedAt: o.startedAt,
    }));

  return {
    summary: { totalOrders: total, avgTime, slaPercent, fastestOrder, slowestOrderTime, peakHourLabel: peakHour?.label },
    hourlyData,
    dailyTrend,
    tableTurnData,
    topItems,
    orderTypeSpeeds,
    slowestOrders,
  };
};

// ─── 2. Hourly Revenue Heatmap ────────────────────────────────────────────────

export const getHourlyHeatmapService = async (
  restaurantId: number,
  branchId?: number,
  from?: string,
  to?: string,
  itemId?: number,
  categoryId?: number,
) => {
  const dateFilter = buildDateFilter(from, to);
  const branchFilter = branchId ? { branchId } : {};
  const itemFiltered = Boolean(itemId || categoryId);

  const byHour: Record<number, { revenue: number; orders: number }> = {};
  const byDay: Record<number, { revenue: number; orders: number }> = {};
  const heatmapRaw: Record<string, number> = {};

  for (let h = 0; h < 24; h++) byHour[h] = { revenue: 0, orders: 0 };
  for (let d = 0; d < 7; d++) byDay[d] = { revenue: 0, orders: 0 };

  if (itemFiltered) {
    // Demand for a specific menu item / category, by hour-of-day & day-of-week.
    // "revenue"/"orders" below represent that item's (or category's) own
    // quantity sold and line revenue — not the whole bill.
    const billItems = await prisma.billItem.findMany({
      where: {
        bill: { restaurantId, ...branchFilter, ...dateFilter, status: "PAID" },
        ...(itemId ? { menuItemId: itemId } : {}),
        ...(categoryId
          ? { menuItem: { categoryId } }
          : {}),
      },
      select: {
        quantity: true,
        total: true,
        createdAt: true,
      },
    });

    billItems.forEach((bi) => {
      const d = new Date(bi.createdAt);
      const h = d.getHours();
      const day = d.getDay();
      byHour[h].revenue += bi.total;
      byHour[h].orders += bi.quantity;
      byDay[day].revenue += bi.total;
      byDay[day].orders += bi.quantity;
      const key = `${day}-${h}`;
      heatmapRaw[key] = (heatmapRaw[key] || 0) + bi.total;
    });
  } else {
    const bills = await prisma.bill.findMany({
      where: { restaurantId, ...branchFilter, ...dateFilter, status: "PAID" },
      select: { total: true, createdAt: true },
    });

    bills.forEach((b) => {
      const d = new Date(b.createdAt);
      const h = d.getHours();
      const day = d.getDay();
      byHour[h].revenue += b.total;
      byHour[h].orders++;
      byDay[day].revenue += b.total;
      byDay[day].orders++;
      const key = `${day}-${h}`;
      heatmapRaw[key] = (heatmapRaw[key] || 0) + b.total;
    });
  }

  const hourlyData = Object.entries(byHour).map(([h, d]) => ({
    hour: Number(h),
    label: HOUR_LABEL(Number(h)),
    revenue: Math.round(d.revenue),
    orders: d.orders,
    avgBill: d.orders && !itemFiltered ? Math.round(d.revenue / d.orders) : 0,
  }));

  const dailyData = Object.entries(byDay).map(([day, d]) => ({
    day: Number(day),
    name: DAY_NAMES[Number(day)],
    short: DAY_NAMES[Number(day)].slice(0, 3),
    revenue: Math.round(d.revenue),
    orders: d.orders,
    avgBill: d.orders && !itemFiltered ? Math.round(d.revenue / d.orders) : 0,
  }));

  const heatmapGrid = [];
  const maxRevenue = Math.max(...Object.values(heatmapRaw), 1);
  for (let day = 0; day < 7; day++) {
    for (let h = 0; h < 24; h++) {
      const rev = Math.round(heatmapRaw[`${day}-${h}`] || 0);
      heatmapGrid.push({
        day, h, dayName: DAY_NAMES[day].slice(0, 3),
        hourLabel: HOUR_LABEL(h),
        revenue: rev,
        intensity: Math.round((rev / maxRevenue) * 100),
      });
    }
  }

  // When filtered to an item/category, "high demand" means highest quantity
  // sold, not revenue (a cheap item sold 50 times is higher demand than an
  // expensive item sold twice).
  const peakHour = itemFiltered
    ? hourlyData.reduce((b, h) => (h.orders > b.orders ? h : b), hourlyData[0])
    : hourlyData.reduce((b, h) => (h.revenue > b.revenue ? h : b), hourlyData[0]);
  const peakDay = itemFiltered
    ? dailyData.reduce((b, d) => (d.orders > b.orders ? d : b), dailyData[0])
    : dailyData.reduce((b, d) => (d.revenue > b.revenue ? d : b), dailyData[0]);

  return {
    hourlyData,
    dailyData,
    heatmapGrid,
    peakHour,
    peakDay,
    itemFiltered,
    demandMetric: itemFiltered ? "quantity" : "revenue",
  };
};

// ─── 3. Customer RFM Scoring ──────────────────────────────────────────────────

export const getCustomerRFMService = async (
  restaurantId: number,
  branchId?: number,
) => {
  const branchFilter = branchId ? { branchId } : {};

  // RFM is inherently an all-time-per-customer computation (truncating a
  // customer's history to a date window would corrupt the frequency/
  // monetary/recency scoring itself) — so the fix here isn't a date filter,
  // it's doing the per-customer rollup in Postgres via groupBy instead of
  // pulling every bill row for every customer into Node to reduce in JS.
  const [customers, billAgg] = await Promise.all([
    prisma.customer.findMany({
      where: { restaurantId },
      select: { id: true, name: true, phone: true },
    }),
    prisma.bill.groupBy({
      by: ["customerId"],
      where: { restaurantId, ...branchFilter, status: "PAID", customerId: { not: null } },
      _count: { id: true },
      _sum: { total: true },
      _max: { createdAt: true },
    }),
  ]);

  const aggByCustomer = new Map(billAgg.map((b) => [b.customerId as number, b]));
  const now = new Date();

  const scored = customers
    .map((c) => {
      const agg = aggByCustomer.get(c.id);
      if (!agg || !agg._max.createdAt) return null;

      const recencyDays = Math.floor(
        (now.getTime() - new Date(agg._max.createdAt).getTime()) / 86400000,
      );
      const frequency = agg._count.id;
      const monetary = Math.round(agg._sum.total || 0);

      const R = recencyDays <= 7 ? 5 : recencyDays <= 30 ? 4 : recencyDays <= 60 ? 3 : recencyDays <= 90 ? 2 : 1;
      const F = frequency >= 10 ? 5 : frequency >= 5 ? 4 : frequency >= 3 ? 3 : frequency >= 2 ? 2 : 1;
      const M = monetary >= 10000 ? 5 : monetary >= 5000 ? 4 : monetary >= 2000 ? 3 : monetary >= 500 ? 2 : 1;
      const rfm = R + F + M;

      const segment =
        rfm >= 13 ? "Champion" :
        rfm >= 10 ? "Loyal" :
        rfm >= 7 ? "Potential" :
        rfm >= 5 ? "At Risk" : "Lost";

      return { id: c.id, name: c.name, phone: c.phone, R, F, M, rfm, segment, recencyDays, frequency, monetary, lastVisit: agg._max.createdAt };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((a, b) => b.rfm - a.rfm);

  const segmentCounts = scored.reduce((acc: Record<string, number>, c) => {
    acc[c.segment] = (acc[c.segment] || 0) + 1;
    return acc;
  }, {});

  const segmentRevenue = scored.reduce((acc: Record<string, number>, c) => {
    acc[c.segment] = (acc[c.segment] || 0) + c.monetary;
    return acc;
  }, {});

  return {
    customers: scored,
    segmentCounts,
    segmentRevenue,
    total: scored.length,
  };
};

// ─── 4. Staff Productivity ────────────────────────────────────────────────────

export const getStaffProductivityService = async (
  restaurantId: number,
  branchId?: number,
  from?: string,
  to?: string,
) => {
  const dateRange = from && to
    ? { date: { gte: new Date(from), lte: new Date(new Date(to).setHours(23, 59, 59, 999)) } }
    : {};
  const branchFilter = branchId ? { branchId } : {};

  const [staff, bills, branch] = await Promise.all([
    prisma.user.findMany({
      where: { restaurantId, isDeleted: false },
      select: {
        id: true, name: true, role: true, department: true, salary: true, shift: true,
        attendances: {
          where: { ...branchFilter, ...dateRange },
          select: {
            totalHours: true,
            manualTotalHours: true,
            overtimeHours: true,
            loginTime: true,
            status: true,
          },
        },
      },
    }),
    prisma.bill.findMany({
      where: {
        restaurantId,
        ...branchFilter,
        ...buildDateFilter(from, to),
        status: "PAID",
      },
      select: { total: true, createdAt: true },
    }),
    branchId
      ? prisma.branch.findUnique({
          where: { id: branchId },
          select: {
            morningShiftHours: true,
            eveningShiftHours: true,
            fullDayShiftHours: true,
            overtimeRateMultiplier: true,
          },
        })
      : Promise.resolve(null),
  ]);

  // Standard hours per shift type and the overtime multiplier are owner
  // configurable per branch (Settings → Branches → Payroll Policy); fall
  // back to sensible defaults when no branch is selected or unset.
  const payrollPolicy = {
    morningShiftHours: branch?.morningShiftHours ?? 6,
    eveningShiftHours: branch?.eveningShiftHours ?? 6,
    fullDayShiftHours: branch?.fullDayShiftHours ?? 10,
    overtimeRateMultiplier: branch?.overtimeRateMultiplier ?? 1.5,
  };
  // Revenue bucketed by shift hours
  const shiftRevenue = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  bills.forEach((b) => {
    const h = new Date(b.createdAt).getHours();
    if (h >= 6 && h < 12) shiftRevenue.morning += b.total;
    else if (h >= 12 && h < 17) shiftRevenue.afternoon += b.total;
    else if (h >= 17 && h < 22) shiftRevenue.evening += b.total;
    else shiftRevenue.night += b.total;
  });

  const staffData = staff.map((s) => {
    const totalHours = toNum(
      s.attendances.reduce(
        (sum, a) => sum + toNum(a.manualTotalHours ?? a.totalHours),
        0,
      ),
    );
    const overtimeHours = toNum(
      s.attendances.reduce((sum, a) => sum + toNum(a.overtimeHours), 0),
    );
    const daysPresent = s.attendances.filter((a) => a.loginTime || a.status === "PRESENT").length;
    const attendanceRate = s.attendances.length
      ? Math.round((daysPresent / s.attendances.length) * 100)
      : 0;
    const monthlySalary = s.salary || 0;
    const standardHours = computeStandardShiftHours(s.shift, payrollPolicy);
    const overtimeCost = computeOvertimeCost(monthlySalary, standardHours, overtimeHours, payrollPolicy.overtimeRateMultiplier);

    return {
      id: s.id, name: s.name, role: s.role,
      department: s.department || "—",
      shift: s.shift || "—",
      monthlySalary,
      totalHours: Math.round(totalHours),
      overtimeHours: Math.round(overtimeHours),
      overtimeCost,
      daysPresent,
      attendanceRate,
      dailyCost: Math.round(monthlySalary / 30),
      costPerHour: totalHours > 0 ? Math.round(monthlySalary / (totalHours * 4.33)) : 0,
    };
  });

  // Department breakdown
  const deptMap: Record<string, { count: number; salary: number; hours: number; overtimeCost: number }> = {};
  staffData.forEach((s) => {
    const d = s.department;
    if (!deptMap[d]) deptMap[d] = { count: 0, salary: 0, hours: 0, overtimeCost: 0 };
    deptMap[d].count++;
    deptMap[d].salary += s.monthlySalary;
    deptMap[d].hours += s.totalHours;
    deptMap[d].overtimeCost += s.overtimeCost;
  });
  const deptData = Object.entries(deptMap).map(([dept, d]) => ({
    dept, count: d.count,
    totalSalary: Math.round(d.salary + d.overtimeCost),
    totalHours: Math.round(d.hours),
    avgSalary: d.count ? Math.round(d.salary / d.count) : 0,
  }));

  return {
    staff: staffData,
    deptData,
    shiftRevenue: {
      morning: Math.round(shiftRevenue.morning),
      afternoon: Math.round(shiftRevenue.afternoon),
      evening: Math.round(shiftRevenue.evening),
      night: Math.round(shiftRevenue.night),
    },
    totals: {
      totalLabourCost: staffData.reduce((s, st) => s + st.monthlySalary + st.overtimeCost, 0),
      totalOvertimeCost: staffData.reduce((s, st) => s + st.overtimeCost, 0),
      totalHoursWorked: staffData.reduce((s, st) => s + st.totalHours, 0),
      totalStaff: staffData.length,
    },
  };
};

// ─── 5. Revenue Forecast (rolling 7-day average) ─────────────────────────────

export const getRevenueForecastService = async (
  restaurantId: number,
  branchId?: number,
) => {
  const branchFilter = branchId ? { branchId } : {};
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const bills = await prisma.bill.findMany({
    where: {
      restaurantId,
      ...branchFilter,
      createdAt: { gte: thirtyDaysAgo },
      status: "PAID",
    },
    select: { total: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  // Group by date
  const byDate: Record<string, number> = {};
  bills.forEach((b) => {
    const key = new Date(b.createdAt).toISOString().slice(0, 10);
    byDate[key] = (byDate[key] || 0) + b.total;
  });

  // Fill missing dates with 0
  const history: { date: string; revenue: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    history.push({ date: key, revenue: Math.round(byDate[key] || 0) });
  }

  // 7-day rolling average for the last 7 days
  const last7 = history.slice(-7);
  const avg7 = last7.length ? Math.round(last7.reduce((s, d) => s + d.revenue, 0) / last7.length) : 0;

  // Previous 7 days
  const prev7 = history.slice(-14, -7);
  const avgPrev7 = prev7.length ? Math.round(prev7.reduce((s, d) => s + d.revenue, 0) / prev7.length) : 0;

  const growthPercent = avgPrev7 > 0 ? parseFloat(((avg7 - avgPrev7) / avgPrev7 * 100).toFixed(1)) : 0;

  // Forecast next 7 days using 7-day rolling average + growth trend
  const growthFactor = avgPrev7 > 0 ? avg7 / avgPrev7 : 1;
  const forecast: { date: string; predicted: number; lower: number; upper: number }[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const predicted = Math.round(avg7 * Math.pow(growthFactor, i / 7));
    forecast.push({
      date: d.toISOString().slice(0, 10),
      predicted,
      lower: Math.round(predicted * 0.85),
      upper: Math.round(predicted * 1.15),
    });
  }

  // Week-over-week breakdown
  const weeklyRevenue = Array.from({ length: 4 }, (_, i) => {
    const week = history.slice(i * 7, (i + 1) * 7);
    return {
      week: `Week ${i + 1}`,
      revenue: Math.round(week.reduce((s, d) => s + d.revenue, 0)),
    };
  });

  return {
    history,
    forecast,
    summary: { avg7, avgPrev7, growthPercent, forecastTotal: forecast.reduce((s, f) => s + f.predicted, 0) },
    weeklyRevenue,
  };
};

// ─── 6. Menu Engineering (Kasavana & Smith matrix: Stars/Plowhorses/Puzzles/Dogs) ─

// Exported for reuse by the finance module (period-accurate food cost =
// recipe cost per dish × quantity actually sold in the period).
export const recipeCostOf = (menuItem: {
  menuItemIngredients: {
    quantity: number;
    unit: string;
    ingredient: { pricePerUnit: number | null; unit: string | null } | null;
  }[];
}) =>
  menuItem.menuItemIngredients.reduce((sum, m) => {
    const ing = m.ingredient;
    if (!ing?.pricePerUnit) return sum;
    const mappingUnit = (m.unit || "").toLowerCase();
    const ingredientUnit = (ing.unit || "").toLowerCase();
    let cost: number;
    if (mappingUnit === ingredientUnit) {
      cost = m.quantity * ing.pricePerUnit;
    } else if (ingredientUnit === "kg" && ["gram", "grams", "gm", "g"].includes(mappingUnit)) {
      cost = (m.quantity / 1000) * ing.pricePerUnit;
    } else if (ingredientUnit === "litre" && ["ml", "millilitre", "milliliter"].includes(mappingUnit)) {
      cost = (m.quantity / 1000) * ing.pricePerUnit;
    } else {
      cost = m.quantity * ing.pricePerUnit;
    }
    return sum + cost;
  }, 0);

export const getMenuEngineeringService = async (
  restaurantId: number,
  branchId?: number,
  from?: string,
  to?: string,
) => {
  const dateFilter = buildDateFilter(from, to);
  const branchFilter = branchId ? { branchId } : {};

  const [menuItems, billItemStats] = await Promise.all([
    prisma.menuItem.findMany({
      where: { restaurantId, isDeleted: false },
      select: {
        id: true,
        name: true,
        price: true,
        category: { select: { name: true } },
        menuItemIngredients: {
          select: {
            quantity: true,
            unit: true,
            ingredient: { select: { pricePerUnit: true, unit: true } },
          },
        },
      },
    }),
    prisma.billItem.groupBy({
      by: ["menuItemId"],
      where: {
        menuItemId: { not: null },
        bill: { restaurantId, ...branchFilter, ...dateFilter, status: "PAID" },
      },
      _sum: { quantity: true, total: true },
    }),
  ]);

  const salesByItem = new Map(billItemStats.map((b) => [b.menuItemId, b]));

  const items = menuItems.map((mi) => {
    const sales = salesByItem.get(mi.id);
    const quantitySold = toNum(sales?._sum.quantity);
    const revenue = toNum(sales?._sum.total);
    const cost = Math.round(recipeCostOf(mi) * 100) / 100;
    const margin = mi.price - cost;
    return {
      id: mi.id,
      name: mi.name,
      category: mi.category?.name || "Uncategorized",
      price: mi.price,
      cost,
      margin: Math.round(margin * 100) / 100,
      marginPct: mi.price > 0 ? Math.round((margin / mi.price) * 1000) / 10 : 0,
      quantitySold,
      revenue,
    };
  });

  const soldItems = items.filter((i) => i.quantitySold > 0);
  const notSold = items.filter((i) => i.quantitySold === 0);
  const totalQtySold = soldItems.reduce((s, i) => s + i.quantitySold, 0);
  const itemCount = soldItems.length;

  // Menu Engineering (Kasavana & Smith) thresholds:
  // - Popularity: an item's share of total units sold vs. the "fair share"
  //   it would get if demand were spread evenly across the menu (1/itemCount).
  //   Popular if actual share >= 70% of fair share — the standard threshold.
  // - Contribution margin: "high" if at/above the quantity-weighted average
  //   margin per unit sold across the whole menu.
  const fairShare = itemCount > 0 ? 1 / itemCount : 0;
  const popularityThreshold = fairShare * 0.7;
  const totalMargin = soldItems.reduce((s, i) => s + i.margin * i.quantitySold, 0);
  const avgMargin = totalQtySold > 0 ? totalMargin / totalQtySold : 0;

  const classified = soldItems.map((i) => {
    const popularityShare = totalQtySold > 0 ? i.quantitySold / totalQtySold : 0;
    const isPopular = popularityShare >= popularityThreshold;
    const isHighMargin = i.margin >= avgMargin;
    const classification =
      isPopular && isHighMargin
        ? "STAR"
        : isPopular && !isHighMargin
          ? "PLOWHORSE"
          : !isPopular && isHighMargin
            ? "PUZZLE"
            : "DOG";
    return {
      ...i,
      popularityShare: Math.round(popularityShare * 1000) / 10,
      classification,
    };
  });

  // Category Cost % generalizes "Beverage Cost %" — same ratio (category COGS
  // ÷ category revenue), applied to whichever category the owner cares about,
  // not just beverages.
  const categoryCostMap: Record<string, { cost: number; revenue: number }> = {};
  for (const i of items) {
    const cat = i.category || "Uncategorized";
    if (!categoryCostMap[cat]) categoryCostMap[cat] = { cost: 0, revenue: 0 };
    categoryCostMap[cat].cost += i.cost * i.quantitySold;
    categoryCostMap[cat].revenue += i.revenue;
  }
  const categoryCostBreakdown = Object.entries(categoryCostMap)
    .map(([category, d]) => ({
      category,
      cost: Math.round(d.cost * 100) / 100,
      revenue: Math.round(d.revenue * 100) / 100,
      costPercentage:
        d.revenue > 0 ? Math.round((d.cost / d.revenue) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    items: classified,
    notSold,
    categoryCostBreakdown,
    summary: {
      star: classified.filter((i) => i.classification === "STAR").length,
      plowhorse: classified.filter((i) => i.classification === "PLOWHORSE").length,
      puzzle: classified.filter((i) => i.classification === "PUZZLE").length,
      dog: classified.filter((i) => i.classification === "DOG").length,
      avgMargin: Math.round(avgMargin * 100) / 100,
      popularityThresholdPct: Math.round(popularityThreshold * 1000) / 10,
    },
  };
};
