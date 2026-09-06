import prisma from "../../../config/prisma";
import { assertAccountAccess } from "../rbac/scope";
import { AUDIT_ACTIONS, auditData, listAuditForResource } from "../audit/audit.service";
import { conflict, invalidState, notFound } from "../shared/apiError";
import { parsePage, parseSort, toPaged } from "../shared/pagination";
import { aggregateByRestaurant, refreshRestaurantActivity, restaurantKpis } from "./restaurantMetrics.service";

/**
 * Restaurants, from DineInk's side of the relationship.
 *
 * The Restaurant rows here are the same rows the owner app and POS read and
 * write — there is no internal copy. What the internal console adds is the
 * platform's own view of each one: where it sits in the funnel, whether it is
 * live, and how it is trading. Those are the columns added to Restaurant by the
 * internal migration; everything else is read straight through.
 */

const RESTAURANT_SORT_FIELDS = ["name", "createdAt", "lastActivityAt", "platformStatus", "onboardingStage"] as const;

export interface RestaurantListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  onboardingStage?: string;
  city?: string;
  state?: string;
  sortBy?: string;
  sortDir?: string;
}

/**
 * Search covers name, restaurant id, phone and email — the four things a
 * support agent actually has in front of them. The id is accepted both bare
 * ("214") and in the RES-214 form the UI displays.
 */
const buildSearchFilter = (search: string) => {
  const term = search.trim();
  const idMatch = term.match(/^(?:res-)?(\d+)$/i);
  const or: any[] = [
    { name: { contains: term, mode: "insensitive" } },
    { email: { contains: term, mode: "insensitive" } },
    { phone: { contains: term } },
    { city: { contains: term, mode: "insensitive" } },
  ];
  if (idMatch) or.push({ id: Number(idMatch[1]) });
  return or;
};

export const listRestaurants = async (query: RestaurantListQuery) => {
  // Keeps lastActivityAt current enough to sort on; throttled internally so a
  // burst of requests triggers at most one refresh.
  await refreshRestaurantActivity();

  const page = parsePage(query);
  const sort = parseSort(query, RESTAURANT_SORT_FIELDS, "createdAt");

  // Every filter is appended as its own AND clause. Search is an OR of several
  // conditions, and two ORs side by side at the top level of a Prisma `where`
  // merge into one — which would return rows matching the search *or* the other
  // filter rather than both. Keeping each in its own AND entry composes
  // correctly.
  const filters: any[] = [];

  if (query.search?.trim()) filters.push({ OR: buildSearchFilter(query.search) });
  if (query.status) filters.push({ platformStatus: query.status });
  if (query.onboardingStage) filters.push({ onboardingStage: query.onboardingStage });
  if (query.city) filters.push({ city: { equals: query.city, mode: "insensitive" } });
  if (query.state) filters.push({ state: { equals: query.state, mode: "insensitive" } });

  // The `activity` filter is gone. It bucketed restaurants into ACTIVE /
  // LOW_ACTIVITY / AT_RISK / INACTIVE from how recently they had taken an
  // order, which is a churn model for a marketplace, not for a software
  // vendor: a cafe closed for a fortnight is not a customer we are losing.
  //
  // `lastActivityAt` is still recorded and still shown, because "when did this
  // tenant last process an order" is a genuinely useful support signal — it is
  // simply no longer dressed up as a commercial risk score. Renewal date and
  // payment status carry that meaning now.

  const where: any = filters.length ? { AND: filters } : {};

  const [rows, total] = await Promise.all([
    prisma.restaurant.findMany({
      where,
      orderBy: { [sort.field]: sort.direction },
      skip: page.skip,
      take: page.take,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        city: true,
        state: true,
        platformStatus: true,
        onboardingStage: true,
        lastActivityAt: true,
        activatedAt: true,
        createdAt: true,
        logo: true,
        _count: { select: { branches: true } },
      },
    }),
    prisma.restaurant.count({ where }),
  ]);

  // One grouped aggregate for the whole page, not one query per row.
  const aggregates = await aggregateByRestaurant(rows.map((r) => r.id));

  const enriched = rows.map((row) => {
    const agg = aggregates.get(row.id);
    return {
      ...row,
      displayId: `RES-${row.id}`,
      branches: row._count.branches,
      orders: agg?.orders ?? 0,
      revenue: agg?.revenue ?? 0,
      lastActivityAt: row.lastActivityAt ?? agg?.lastOrderAt ?? null,
      _count: undefined,
    };
  });

  return toPaged(enriched, total, page);
};

export const getRestaurant = async (restaurantId: number) => {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    include: {
      owner: { select: { id: true, name: true, email: true, phone: true } },
      branches: {
        where: { isDeleted: false },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          city: true,
          state: true,
          pincode: true,
          address: true,
          phone: true,
          email: true,
          isActive: true,
          openingTime: true,
          closingTime: true,
          createdAt: true,
        },
      },
      _count: { select: { menuItems: true, customers: true, users: true } },
    },
  });
  if (!restaurant) throw notFound("Restaurant not found", "RESTAURANT_NOT_FOUND");

  const kpis = await restaurantKpis(restaurantId);

  return {
    id: restaurant.id,
    displayId: `RES-${restaurant.id}`,
    name: restaurant.name,
    logo: restaurant.logo,
    email: restaurant.email,
    phone: restaurant.phone,
    address: restaurant.address,
    city: restaurant.city,
    state: restaurant.state,
    pincode: restaurant.pincode,
    cuisine: restaurant.cuisine,
    platformStatus: restaurant.platformStatus,
    onboardingStage: restaurant.onboardingStage,
    activatedAt: restaurant.activatedAt,
    suspendedAt: restaurant.suspendedAt,
    suspensionReason: restaurant.suspensionReason,
    internalNotes: restaurant.internalNotes,
    createdAt: restaurant.createdAt,
    // Reported as what it is — when this tenant last processed an order — not
    // as a risk classification.
    lastActivityAt: restaurant.lastActivityAt ?? kpis.lastOrderAt,
    owner: restaurant.owner,
    branches: restaurant.branches,
    counts: {
      branches: restaurant.branches.length,
      menuItems: restaurant._count.menuItems,
      customers: restaurant._count.customers,
      users: restaurant._count.users,
    },
    kpis,
  };
};

/**
 * Financial and statutory fields are split out rather than folded into the main
 * detail payload: they need RESTAURANT_FINANCIAL_VIEW, and the cheapest way to
 * guarantee an employee without it never receives them is for the endpoint that
 * returns them to be a different endpoint.
 */
export const getRestaurantFinancialProfile = async (restaurantId: number) => {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, name: true, gstNumber: true },
  });
  if (!restaurant) throw notFound("Restaurant not found", "RESTAURANT_NOT_FOUND");

  // BankAccount stores `accountNumberMasked` — the full number is never
  // persisted in the first place, so there is nothing here to unmask and this
  // endpoint can return the column as-is.
  const bankAccounts = await prisma.bankAccount.findMany({
    where: { restaurantId, isActive: true },
    select: {
      id: true,
      bankName: true,
      accountNumberMasked: true,
      ifsc: true,
      accountHolderName: true,
      isPrimary: true,
      branchId: true,
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });

  return { gstNumber: restaurant.gstNumber, bankAccounts };
};

export interface CreateRestaurantInput {
  /** The customer this tenant belongs to. Required — a system with no owner is
   *  a system nobody is paying for, and it would be invisible to every scoped
   *  query. */
  accountId: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  cuisine?: string | null;
  internalNotes?: string | null;
}

export const createRestaurant = async (req: any, input: CreateRestaurantInput) => {
  const name = input.name?.trim();
  if (!name) throw invalidState("Enter the restaurant's name.", "NAME_REQUIRED");
  if (!input.accountId) throw invalidState("Choose the customer this system belongs to.", "ACCOUNT_REQUIRED");

  await assertAccountAccess(req, input.accountId);
  const account = await prisma.account.findUnique({
    where: { id: input.accountId },
    select: { id: true, name: true },
  });
  if (!account) throw notFound("No customer with that id.", "ACCOUNT_NOT_FOUND");

  const duplicate = await prisma.restaurant.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(input.city ? { city: { equals: input.city, mode: "insensitive" } } : {}),
    },
    select: { id: true, name: true, city: true },
  });
  if (duplicate) {
    throw conflict(
      `A restaurant called "${duplicate.name}"${duplicate.city ? ` in ${duplicate.city}` : ""} already exists (RES-${duplicate.id}).`,
      "RESTAURANT_EXISTS",
    );
  }

  return prisma.$transaction(async (tx) => {
    const restaurant = await tx.restaurant.create({
      data: {
        name,
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        address: input.address?.trim() || null,
        city: input.city?.trim() || null,
        state: input.state?.trim() || null,
        pincode: input.pincode?.trim() || null,
        cuisine: input.cuisine?.trim() || null,
        internalNotes: input.internalNotes?.trim() || null,
        // A tenant is provisioned for a customer that already exists. The
        // commercial record is the Account; this is the system it runs on.
        accountId: input.accountId,
        platformStatus: "ONBOARDING",
        onboardingStage: "ONBOARDING",
      },
    });

    await tx.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.RESTAURANT_CREATED,
        resourceType: "Restaurant",
        resourceId: restaurant.id,
        resourceLabel: restaurant.name,
        newValue: { name, city: input.city ?? null, platformStatus: "LEAD" },
      }),
    });

    return restaurant;
  });
};

const EDITABLE_FIELDS = [
  "name",
  "email",
  "phone",
  "address",
  "city",
  "state",
  "pincode",
  "cuisine",
  "internalNotes",
] as const;

export const updateRestaurant = async (req: any, restaurantId: number, input: Record<string, any>) => {
  const existing = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
  if (!existing) throw notFound("Restaurant not found", "RESTAURANT_NOT_FOUND");

  const data: Record<string, any> = {};
  for (const field of EDITABLE_FIELDS) {
    if (input[field] !== undefined) {
      const value = typeof input[field] === "string" ? input[field].trim() : input[field];
      data[field] = value === "" ? null : value;
    }
  }
  if (!Object.keys(data).length) {
    throw invalidState("Nothing to update.", "NO_CHANGES");
  }
  if (data.name !== undefined && !data.name) {
    throw invalidState("A restaurant must have a name.", "NAME_REQUIRED");
  }

  const previous: Record<string, any> = {};
  for (const key of Object.keys(data)) previous[key] = (existing as any)[key];

  const [updated] = await prisma.$transaction([
    prisma.restaurant.update({ where: { id: restaurantId }, data }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.RESTAURANT_UPDATED,
        resourceType: "Restaurant",
        resourceId: restaurantId,
        resourceLabel: existing.name,
        previousValue: previous,
        newValue: data,
      }),
    }),
  ]);

  return updated;
};

/**
 * Enables the tenant.
 *
 * A technical act: the restaurant's staff can sign in and take orders. This is
 * not the same as the customer going live, which is signed off on the account's
 * onboarding and carries the mandatory-checklist gate.
 */
export const activateRestaurant = async (req: any, restaurantId: number, reason?: string | null) => {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, name: true, platformStatus: true, onboardingStage: true },
  });
  if (!restaurant) throw notFound("Restaurant not found", "RESTAURANT_NOT_FOUND");

  if (restaurant.platformStatus === "ACTIVE") {
    throw invalidState(`${restaurant.name} is already active.`, "ALREADY_ACTIVE");
  }

  // The onboarding gate is no longer here.
  //
  // Activating a restaurant is now a *technical* act — enabling the tenant so
  // its staff can sign in and take orders. Declaring the *customer* live, which
  // is the thing that needs every mandatory step signed off, happens on the
  // account's onboarding (see onboarding.service.goLive). Keeping the gate in
  // both places would mean two sources of truth that could disagree, and the
  // account is the one that matches how the business actually works: a group
  // goes live once, even if its four tenants are enabled on four days.

  const [updated] = await prisma.$transaction([
    prisma.restaurant.update({
      where: { id: restaurantId },
      data: {
        platformStatus: "ACTIVE",
        onboardingStage: "ACTIVE",
        activatedAt: new Date(),
        suspendedAt: null,
        suspensionReason: null,
      },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action:
          restaurant.platformStatus === "SUSPENDED"
            ? AUDIT_ACTIONS.RESTAURANT_REINSTATED
            : AUDIT_ACTIONS.RESTAURANT_ACTIVATED,
        resourceType: "Restaurant",
        resourceId: restaurantId,
        resourceLabel: restaurant.name,
        previousValue: { platformStatus: restaurant.platformStatus, onboardingStage: restaurant.onboardingStage },
        newValue: { platformStatus: "ACTIVE", onboardingStage: "ACTIVE" },
        reason: reason ?? null,
      }),
    }),
  ]);

  return updated;
};

export const suspendRestaurant = async (req: any, restaurantId: number, reason: string) => {
  if (!reason?.trim()) {
    throw invalidState("Suspending a restaurant needs a reason — it's recorded in the audit log.", "REASON_REQUIRED");
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, name: true, platformStatus: true },
  });
  if (!restaurant) throw notFound("Restaurant not found", "RESTAURANT_NOT_FOUND");
  if (restaurant.platformStatus === "SUSPENDED") {
    throw invalidState(`${restaurant.name} is already suspended.`, "ALREADY_SUSPENDED");
  }
  if (restaurant.platformStatus !== "ACTIVE") {
    throw invalidState(
      `Only a live restaurant can be suspended. ${restaurant.name} is currently ${restaurant.platformStatus.toLowerCase()}.`,
      "NOT_ACTIVE",
    );
  }

  const [updated] = await prisma.$transaction([
    prisma.restaurant.update({
      where: { id: restaurantId },
      data: { platformStatus: "SUSPENDED", suspendedAt: new Date(), suspensionReason: reason.trim() },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.RESTAURANT_SUSPENDED,
        resourceType: "Restaurant",
        resourceId: restaurantId,
        resourceLabel: restaurant.name,
        previousValue: { platformStatus: restaurant.platformStatus },
        newValue: { platformStatus: "SUSPENDED" },
        reason: reason.trim(),
      }),
    }),
  ]);

  return updated;
};

export const getRestaurantActivity = (restaurantId: number, limit = 50) =>
  listAuditForResource("Restaurant", restaurantId, limit);

/** Distinct cities/states actually present, for the list page's filter menus. */
export const getRestaurantFilterOptions = async () => {
  const [cities, states] = await Promise.all([
    prisma.restaurant.findMany({
      where: { city: { not: null } },
      distinct: ["city"],
      select: { city: true },
      orderBy: { city: "asc" },
      take: 200,
    }),
    prisma.restaurant.findMany({
      where: { state: { not: null } },
      distinct: ["state"],
      select: { state: true },
      orderBy: { state: "asc" },
      take: 100,
    }),
  ]);
  return {
    cities: cities.map((c) => c.city).filter(Boolean),
    states: states.map((s) => s.state).filter(Boolean),
  };
};
