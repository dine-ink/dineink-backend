import prisma from "../../config/prisma";

export const getCustomersByBranchService = async (
  restaurantId: number,
  branchId?: number | null,
  page = 1,
  limit = 100,
) => {
  const customers = await prisma.customer.findMany({
    where: {
      restaurantId,
      ...(branchId && { bills: { some: { branchId } } }),
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      address: true,
      createdAt: true,
      // PAID-only — matches the "repeat customer" / "visits" definition used
      // everywhere else (branchComparison.service.ts, Executive Dashboard);
      // previously included PENDING/CANCELLED bills too, so this page's
      // Repeat Customer Rate (and spend/lastVisit) disagreed with every
      // other screen showing the same concept.
      bills: {
        where: { status: "PAID", ...(branchId && { branchId }) },
        select: {
          id: true,
          total: true,
          orderType: true,
          paymentMethod: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: (page - 1) * limit,
  });

  return customers.map(({ bills, ...customer }) => ({
    ...customer,
    visits: bills.length,
    spend: bills.reduce((sum, bill) => sum + bill.total, 0),
    lastVisit: bills[0]?.createdAt ?? null,
    preferredOrderType: bills[0]?.orderType ?? null,
    preferredPayment: bills[0]?.paymentMethod ?? null,
    bills,
  }));
};

// Point lookup for checkout — a phone number typed at the register should
// surface "returning customer, N visits" immediately, without fetching the
// whole customer list just to find one match.
export const lookupCustomerByPhoneService = async (restaurantId: number, phone: string) => {
  const customer = await prisma.customer.findFirst({
    where: { restaurantId, phone },
    select: {
      id: true,
      name: true,
      phone: true,
      bills: {
        select: { total: true, orderType: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!customer) return null;

  const { bills, ...rest } = customer;
  return {
    ...rest,
    visits: bills.length,
    spend: bills.reduce((sum, bill) => sum + bill.total, 0),
    lastVisit: bills[0]?.createdAt ?? null,
    preferredOrderType: bills[0]?.orderType ?? null,
  };
};

/** Default window for the returned `bills` array — the UI's longest look-back
 *  (12-month LTV and visit frequency) plus a month of slack. */
const DEFAULT_BILL_WINDOW_DAYS = 400;

/**
 * This used to return every bill ever recorded for every customer in one
 * `include`, which at `limit=5000` (the WhatsApp bulk-send panel) meant a
 * response measured in megabytes. Now:
 *
 *  - `visits`, `spend` and `lastVisit` come from a database-side aggregate, so
 *    they remain exact lifetime figures and cost no payload.
 *  - The `bills` array is bounded to `billWindowDays`, which is all the
 *    frontend's cohort/LTV maths looks at, and can be skipped entirely with
 *    `includeBills: false` for callers that only need the summary.
 */
export const getCustomersByRestaurantService = async (
  restaurantId: number,
  page = 1,
  limit = 100,
  opts: { includeBills?: boolean; billWindowDays?: number } = {},
) => {
  const { includeBills = true, billWindowDays = DEFAULT_BILL_WINDOW_DAYS } = opts;

  const customers = await prisma.customer.findMany({
    where: { restaurantId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      address: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: (page - 1) * limit,
  });

  const ids = customers.map((c) => c.id);
  if (ids.length === 0) return [];

  const since = new Date(Date.now() - billWindowDays * 24 * 60 * 60 * 1000);

  const fetchWindowBills = () =>
    prisma.bill.findMany({
      where: { customerId: { in: ids }, createdAt: { gte: since } },
      select: {
        id: true,
        customerId: true,
        total: true,
        orderType: true,
        paymentMethod: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  type WindowBill = Awaited<ReturnType<typeof fetchWindowBills>>[number];

  const [totals, windowBills] = await Promise.all([
    // Lifetime totals — unbounded on purpose, but aggregated in Postgres so
    // only one small row per customer crosses the wire.
    prisma.bill.groupBy({
      by: ["customerId"],
      where: { customerId: { in: ids } },
      _count: { _all: true },
      _sum: { total: true },
      _max: { createdAt: true },
    }),
    includeBills ? fetchWindowBills() : Promise.resolve([] as WindowBill[]),
  ]);

  const totalsById = new Map(totals.map((t) => [t.customerId, t]));
  const billsById = new Map<number, WindowBill[]>();
  for (const bill of windowBills) {
    if (bill.customerId == null) continue;
    const bucket = billsById.get(bill.customerId);
    if (bucket) bucket.push(bill);
    else billsById.set(bill.customerId, [bill]);
  }

  return customers.map((customer) => {
    const agg = totalsById.get(customer.id);
    const bills = billsById.get(customer.id) ?? [];
    // Preferred order type/payment come from the most recent bill in the
    // window; a customer whose last visit predates it reports null, which the
    // UI already renders as "-".
    return {
      ...customer,
      visits: agg?._count._all ?? 0,
      spend: agg?._sum.total ?? 0,
      lastVisit: agg?._max.createdAt ?? null,
      preferredOrderType: bills[0]?.orderType ?? null,
      preferredPayment: bills[0]?.paymentMethod ?? null,
      bills,
    };
  });
};
