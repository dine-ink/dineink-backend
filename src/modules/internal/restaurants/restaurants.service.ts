import prisma from "../../../config/prisma";
import { AUDIT_ACTIONS, auditData, listAuditForResource } from "../audit/audit.service";
import { createOnboardingChecklist, getChecklist } from "../onboarding/onboarding.service";
import { classifyActivity, getActivityThresholds } from "../settings/platformSettings.service";
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
  activity?: string;
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
  // Keeps the activity column current enough to filter and sort on; throttled
  // internally so a burst of requests triggers at most one refresh.
  await refreshRestaurantActivity();

  const page = parsePage(query);
  const sort = parseSort(query, RESTAURANT_SORT_FIELDS, "createdAt");
  const thresholds = await getActivityThresholds();

  // Every filter is appended as its own AND clause. Search and the INACTIVE
  // activity bucket are each an OR of several conditions, and putting two ORs
  // side by side at the top level of a Prisma `where` merges them into one —
  // which would return rows matching the search *or* the activity rather than
  // both. Keeping each in its own AND entry makes them compose correctly.
  const filters: any[] = [];

  if (query.search?.trim()) filters.push({ OR: buildSearchFilter(query.search) });
  if (query.status) filters.push({ platformStatus: query.status });
  if (query.onboardingStage) filters.push({ onboardingStage: query.onboardingStage });
  if (query.city) filters.push({ city: { equals: query.city, mode: "insensitive" } });
  if (query.state) filters.push({ state: { equals: query.state, mode: "insensitive" } });

  // Activity is a function of lastActivityAt and the configured thresholds, so
  // it becomes a date range in the query rather than a post-filter — filtering
  // after pagination would return the wrong rows for every page but the first.
  if (query.activity) {
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
    const activityFilter = ((): any | null => {
      switch (query.activity) {
        case "ACTIVE":
          return { lastActivityAt: { gte: daysAgo(1) } };
        case "LOW_ACTIVITY":
          return { lastActivityAt: { gte: daysAgo(thresholds.inactiveDays), lt: daysAgo(1) } };
        case "AT_RISK":
          return {
            lastActivityAt: { gte: daysAgo(thresholds.atRiskDays), lt: daysAgo(thresholds.inactiveDays) },
          };
        case "INACTIVE":
          // A live restaurant that has never taken an order counts as inactive;
          // one that isn't live yet is simply not trading and doesn't belong in
          // the operations team's inactive queue.
          return {
            OR: [
              { lastActivityAt: { lt: daysAgo(thresholds.atRiskDays) } },
              { lastActivityAt: null, platformStatus: "ACTIVE" },
            ],
          };
        default:
          return null;
      }
    })();
    if (activityFilter) filters.push(activityFilter);
  }

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
      activity: classifyActivity(row.lastActivityAt ?? agg?.lastOrderAt ?? null, thresholds, row.platformStatus),
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

  const [kpis, thresholds, checklist] = await Promise.all([
    restaurantKpis(restaurantId),
    getActivityThresholds(),
    getChecklist(restaurantId),
  ]);

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
    lastActivityAt: restaurant.lastActivityAt ?? kpis.lastOrderAt,
    activity: classifyActivity(
      restaurant.lastActivityAt ?? kpis.lastOrderAt,
      thresholds,
      restaurant.platformStatus,
    ),
    owner: restaurant.owner,
    branches: restaurant.branches,
    counts: {
      branches: restaurant.branches.length,
      menuItems: restaurant._count.menuItems,
      customers: restaurant._count.customers,
      users: restaurant._count.users,
    },
    kpis,
    onboarding: checklist.summary,
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
        platformStatus: "LEAD",
        onboardingStage: "LEAD",
      },
    });

    await createOnboardingChecklist(tx, restaurant.id);

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
 * Going live.
 *
 * The mandatory checklist is enforced here, in the service, and not merely
 * disabled in the UI — the brief is explicit that activation must be blocked
 * when mandatory requirements are incomplete, and a button that is only
 * greyed out is not a block.
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

  // getChecklist materializes the checklist if the restaurant hasn't got one,
  // so this can't be evaluated against an empty task list.
  const { summary } = await getChecklist(restaurantId);

  // Belt and braces: an empty checklist produces zero blockers, which would
  // read as "everything complete". If the template ever failed to materialize,
  // refuse rather than wave the restaurant through.
  if (summary.mandatoryTotal === 0) {
    throw invalidState(
      `${restaurant.name} has no onboarding checklist, so it can't be verified as ready. Open the Onboarding tab to generate one.`,
      "ONBOARDING_CHECKLIST_MISSING",
    );
  }

  if (summary.blockers.length) {
    throw invalidState(
      `${restaurant.name} can't go live yet — ${summary.blockers.length} mandatory onboarding step${
        summary.blockers.length === 1 ? "" : "s"
      } outstanding.`,
      "ONBOARDING_INCOMPLETE",
      { blockers: summary.blockers },
    );
  }

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
