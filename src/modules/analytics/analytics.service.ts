import prisma from "../../config/prisma";

export const getDashboardOverviewService = async (
  restaurantId: number,
  branchId?: number | null,
  range = "today",
) => {
  let startDate = new Date();
  switch (range) {
    case "today":
      startDate.setHours(0, 0, 0, 0);
      break;
    case "week":
      startDate.setDate(startDate.getDate() - 6);
      break;
    case "month":
      startDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      break;
    case "quarter":
      startDate.setMonth(startDate.getMonth() - 3);
      break;
    default:
      startDate.setHours(0, 0, 0, 0);
  }

  const bills = await prisma.bill.findMany({
    where: {
      restaurantId,
      ...(branchId && {
        branchId,
      }),
      createdAt: {
        gte: startDate,
      },
    },
    include: {
      items: true,
      customer: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const hourlyAnalytics: Record<
    number,
    {
      orders: number;
      revenue: number;
    }
  > = {};
  bills.forEach((bill) => {
    const hour = new Date(bill.createdAt).getHours();
    if (!hourlyAnalytics[hour]) {
      hourlyAnalytics[hour] = {
        orders: 0,
        revenue: 0,
      };
    }
    hourlyAnalytics[hour].orders += 1;
    hourlyAnalytics[hour].revenue += bill.total;
  });

  const latestOrders = await prisma.bill.findMany({
    where: {
      restaurantId,
      ...(branchId && {
        branchId,
      }),
    },
    include: {
      customer: true,
      items: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 10,
  });

  const customerOrdersMap: Record<number, number> = {};
  bills.forEach((bill) => {
    if (!bill.customerId) return;
    customerOrdersMap[bill.customerId] =
      (customerOrdersMap[bill.customerId] || 0) + 1;
  });

  const totalCustomers = Object.keys(customerOrdersMap).length;

  const repeatCustomersCount = Object.values(customerOrdersMap).filter(
    (count) => count > 1,
  ).length;

  const branches = await prisma.branch.count({
    where: {
      restaurantId,
    },
  });

  const tables = await prisma.restaurantTable.findMany({
    where: {
      restaurantId,
      ...(branchId && {
        branchId,
      }),
    },
  });

  const occupiedTables = tables.filter((t) => t.status === "OCCUPIED").length;

  const totalRevenue = bills.reduce((sum, bill) => sum + bill.total, 0);

  const totalOrders = bills.length;

  const avgOrderValue = totalOrders ? totalRevenue / totalOrders : 0;

  const paymentMap: any = {};

  bills.forEach((bill) => {
    if (!paymentMap[bill.paymentMethod]) {
      paymentMap[bill.paymentMethod] = 0;
    }
    paymentMap[bill.paymentMethod] += bill.total;
  });

  const itemMap: any = {};

  bills.forEach((bill) => {
    bill.items.forEach((item) => {
      if (!itemMap[item.itemName]) {
        itemMap[item.itemName] = 0;
      }
      itemMap[item.itemName] += item.quantity;
    });
  });

  const topItems = Object.entries(itemMap)
    .sort((a: any, b: any) => b[1] - a[1])
    .slice(0, 5)
    .map((i: any) => ({
      name: i[0],
      quantity: i[1],
    }));

  const revenueByDate: any = {};

  const ordersByDate: any = {};

  bills.forEach((bill) => {
    const date = new Date(bill.createdAt).toLocaleDateString("en-IN");
    if (!revenueByDate[date]) {
      revenueByDate[date] = 0;
    }
    if (!ordersByDate[date]) {
      ordersByDate[date] = 0;
    }
    revenueByDate[date] += bill.total;
    ordersByDate[date] += 1;
  });

  let peakHour = 0;

  let peakOrders = 0;

  Object.entries(hourlyAnalytics).forEach(([hour, data]) => {
    if (data.orders > peakOrders) {
      peakOrders = data.orders;

      peakHour = Number(hour);
    }
  });

  const formatHour = (hour: number) => {
    const start = hour % 12 || 12;
    const end = (hour + 1) % 12 || 12;
    const period = hour >= 12 ? "PM" : "AM";
    return `${start} ${period} - ${end} ${period}`;
  };

  const peakHours = formatHour(peakHour);

  return {
    totalRevenue,
    totalOrders,
    avgOrderValue,
    totalCustomers,
    occupiedTables,
    branches,
    topItems,
    paymentSplit: paymentMap,
    recentOrders: latestOrders,
    revenueByDate,
    ordersByDate,
    repeatCustomersCount,
    hourlyAnalytics,
    peakHours,
  };
};

export const saveRestaurantInsightsData = async (data: any) => {
  const { restaurantId, branchId, revenue, ...rest } = data;

  return prisma.restaurantInsights.upsert({
    where: {
      restaurantId_branchId: {
        restaurantId,
        branchId,
      },
    },

    update: {
      ...rest,
    },

    create: {
      restaurantId,
      branchId,
      ...rest,
    },
  });
};

export const getBranchInsightsData = async (
  restaurantId: number,
  branchId: number,
) => {
  const insights = await prisma.restaurantInsights.findUnique({
    where: {
      restaurantId_branchId: {
        restaurantId,
        branchId,
      },
    },
  });

  const sales = await prisma.bill.aggregate({
    _sum: {
      total: true,
    },

    where: {
      restaurantId,
      branchId,
      status: "PAID",
    },
  });

  const revenue = sales._sum.total || 0;

  return {
    ...insights,
    revenue,
  };
};

export const getRestaurantInsightsData = async (restaurantId: number) => {
  const insights = await prisma.restaurantInsights.findMany({
    where: {
      restaurantId,
    },
  });

  const sales = await prisma.bill.aggregate({
    _sum: {
      total: true,
    },

    where: {
      restaurantId,
      status: "PAID",
    },
  });

  const revenue = sales._sum.total || 0;

  const totals = insights.reduce((acc: any, item: any) => {
    Object.keys(item).forEach((key) => {
      if (typeof item[key] === "number") {
        acc[key] = (acc[key] || 0) + item[key];
      }
    });

    return acc;
  }, {});

  return {
    ...totals,
    revenue,
  };
};

export const getDashboardOverviewDataService = async (range = "today") => {
  let startDate = new Date();
  switch (range) {
    case "today":
      startDate.setHours(0, 0, 0, 0);
      break;
    case "week":
      startDate.setDate(startDate.getDate() - 6);
      break;
    case "month":
      startDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      break;
    case "quarter":
      startDate.setMonth(startDate.getMonth() - 3);
      break;
    default:
      startDate.setHours(0, 0, 0, 0);
  }
  const bills = await prisma.bill.findMany({
    include: {
      items: true,
      customer: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    where: {
      createdAt: {
        gte: startDate,
      },
    },
  });

  const hourlyAnalytics: Record<
    number,
    {
      orders: number;
      revenue: number;
    }
  > = {};

  bills.forEach((bill) => {
    const hour = new Date(bill.createdAt).getHours();
    if (!hourlyAnalytics[hour]) {
      hourlyAnalytics[hour] = { orders: 0, revenue: 0 };
    }
    hourlyAnalytics[hour].orders += 1;
    hourlyAnalytics[hour].revenue += bill.total;
  });
  const latestOrders = await prisma.bill.findMany({
    include: {
      customer: true,
      items: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 10,
  });

  const customerOrdersMap: Record<number, number> = {};
  bills.forEach((bill) => {
    if (!bill.customerId) return;
    customerOrdersMap[bill.customerId] =
      (customerOrdersMap[bill.customerId] || 0) + 1;
  });
  const totalCustomers = Object.keys(customerOrdersMap).length;
  const repeatCustomersCount = Object.values(customerOrdersMap).filter(
    (count) => count > 1,
  ).length;
  const branches = await prisma.branch.count();
  const tables = await prisma.restaurantTable.findMany();
  const occupiedTables = tables.filter((t) => t.status === "OCCUPIED").length;
  const totalRevenue = bills.reduce((sum, bill) => sum + bill.total, 0);
  const totalOrders = bills.length;
  const avgOrderValue = totalOrders ? totalRevenue / totalOrders : 0;
  const paymentMap: any = {};
  bills.forEach((bill) => {
    if (!paymentMap[bill.paymentMethod]) {
      paymentMap[bill.paymentMethod] = 0;
    }
    paymentMap[bill.paymentMethod] += bill.total;
  });
  const itemMap: any = {};
  bills.forEach((bill) => {
    bill.items.forEach((item) => {
      if (!itemMap[item.itemName]) {
        itemMap[item.itemName] = 0;
      }

      itemMap[item.itemName] += item.quantity;
    });
  });
  const topItems = Object.entries(itemMap)
    .sort((a: any, b: any) => b[1] - a[1])
    .slice(0, 5)
    .map((i: any) => ({
      name: i[0],
      quantity: i[1],
    }));
  const revenueByDate: any = {};
  const ordersByDate: any = {};
  bills.forEach((bill) => {
    const date = new Date(bill.createdAt).toLocaleDateString("en-IN");
    if (!revenueByDate[date]) {
      revenueByDate[date] = 0;
    }
    if (!ordersByDate[date]) {
      ordersByDate[date] = 0;
    }
    revenueByDate[date] += bill.total;
    ordersByDate[date] += 1;
  });
  let peakHour = 0;
  let peakOrders = 0;
  Object.entries(hourlyAnalytics).forEach(([hour, data]) => {
    if (data.orders > peakOrders) {
      peakOrders = data.orders;

      peakHour = Number(hour);
    }
  });
  const formatHour = (hour: number) => {
    const start = hour % 12 || 12;
    const end = (hour + 1) % 12 || 12;
    const period = hour >= 12 ? "PM" : "AM";
    return `${start} ${period} - ${end} ${period}`;
  };
  const peakHours = formatHour(peakHour);
  return {
    totalRevenue,
    totalOrders,
    avgOrderValue,
    totalCustomers,
    occupiedTables,
    branches,
    topItems,
    paymentSplit: paymentMap,
    recentOrders: latestOrders,
    revenueByDate,
    ordersByDate,
    repeatCustomersCount,
    hourlyAnalytics,
    peakHours,
  };
};
