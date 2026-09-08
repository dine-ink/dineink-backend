import prisma from "../../../config/prisma";
import { AUDIT_ACTIONS, auditData } from "../audit/audit.service";
import { conflict, invalidState, notFound } from "../shared/apiError";

/**
 * The product catalogue: what DineInk sells.
 *
 * Global configuration, deliberately separate from what any one customer has
 * bought. "Professional plan" lives here; "ABC Restaurant Group is on RDS
 * Professional" is a Subscription.
 *
 * Every commercial term on a Plan — price, currency, billing interval, trial
 * length, included seats and locations — is nullable and seeded unset, because
 * Dineink has not defined them. Null is rendered as "Not configured" everywhere
 * it surfaces. A plausible default would be indistinguishable from a real
 * figure the moment it reached a screen, and someone would quote it.
 */

export const listProducts = async (includeRetired = false) => {
  const products = await prisma.product.findMany({
    where: includeRetired ? {} : { status: "ACTIVE" },
    orderBy: { sortOrder: "asc" },
    include: {
      plans: {
        where: includeRetired ? {} : { status: "ACTIVE" },
        orderBy: { sortOrder: "asc" },
      },
      _count: { select: { subscriptions: true } },
    },
  });

  return products.map((product) => ({
    ...product,
    plans: product.plans.map(serializePlan),
    // Surfaced so the subscription form knows whether to require a plan: RDS
    // has two, Dot has none, and that difference is data rather than a special
    // case in the UI.
    hasPlans: product.plans.length > 0,
  }));
};

export const getProduct = async (productId: number) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      plans: { orderBy: { sortOrder: "asc" }, include: { _count: { select: { subscriptions: true } } } },
      _count: { select: { subscriptions: true } },
    },
  });
  if (!product) throw notFound("No product with that id.", "PRODUCT_NOT_FOUND");

  // Live subscription counts per plan, so the catalogue screen can show what is
  // actually in use before someone retires a plan out from under it.
  const liveByPlan = await prisma.subscription.groupBy({
    by: ["planId"],
    where: { productId, status: { in: ["ACTIVE", "TRIAL"] } },
    _count: { _all: true },
  });
  const liveMap = new Map(liveByPlan.map((row) => [row.planId, row._count._all]));

  return {
    ...product,
    hasPlans: product.plans.length > 0,
    plans: product.plans.map((plan) => ({
      ...serializePlan(plan),
      subscriptionCount: plan._count.subscriptions,
      liveSubscriptionCount: liveMap.get(plan.id) ?? 0,
    })),
  };
};

/**
 * Decimal columns arrive as Prisma Decimal objects, which serialize to strings
 * over JSON and then silently fail arithmetic in the browser. Converting here
 * keeps that conversion in one place — and preserves null, which is the whole
 * point of the nullable pricing.
 */
const serializePlan = (plan: any) => ({
  ...plan,
  priceAmount: plan.priceAmount === null || plan.priceAmount === undefined ? null : Number(plan.priceAmount),
  /** True when this plan has enough configured to bill or forecast from. */
  pricingConfigured: plan.priceAmount !== null && plan.priceAmount !== undefined && Boolean(plan.billingInterval),
});

export const listPlans = async (query: { productId?: number; includeRetired?: boolean } = {}) => {
  const plans = await prisma.plan.findMany({
    where: {
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.includeRetired ? {} : { status: "ACTIVE" }),
    },
    orderBy: [{ productId: "asc" }, { sortOrder: "asc" }],
    include: {
      product: { select: { id: true, key: true, name: true } },
      _count: { select: { subscriptions: true } },
    },
  });
  return plans.map(serializePlan);
};

export const getPlan = async (planId: number) => {
  const plan = await prisma.plan.findUnique({
    where: { id: planId },
    include: {
      product: { select: { id: true, key: true, name: true } },
      _count: { select: { subscriptions: true } },
    },
  });
  if (!plan) throw notFound("No plan with that id.", "PLAN_NOT_FOUND");

  const [live, byStatus] = await Promise.all([
    prisma.subscription.count({ where: { planId, status: { in: ["ACTIVE", "TRIAL"] } } }),
    prisma.subscription.groupBy({ by: ["status"], where: { planId }, _count: { _all: true } }),
  ]);

  return {
    ...serializePlan(plan),
    liveSubscriptionCount: live,
    subscriptionsByStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
  };
};

// ─── Products ────────────────────────────────────────────────────────────────

export const createProduct = async (req: any, input: any) => {
  const key = input.key?.trim().toUpperCase();
  const name = input.name?.trim();
  if (!key) throw invalidState("Give the product a key.", "KEY_REQUIRED");
  if (!name) throw invalidState("Give the product a name.", "NAME_REQUIRED");
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
    throw invalidState("A product key uses capitals, digits and underscores only.", "INVALID_KEY");
  }

  const existing = await prisma.product.findUnique({ where: { key } });
  if (existing) throw conflict(`A product with the key ${key} already exists.`, "PRODUCT_EXISTS");

  const [product] = await prisma.$transaction([
    prisma.product.create({
      data: {
        key,
        name,
        description: input.description?.trim() || null,
        targetSegment: input.targetSegment?.trim() || null,
        sortOrder: Number(input.sortOrder) || 0,
      },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.PRODUCT_CREATED,
        resourceType: "Product",
        resourceId: key,
        resourceLabel: name,
        newValue: { key, name },
      }),
    }),
  ]);
  return product;
};

export const updateProduct = async (req: any, productId: number, input: any) => {
  const existing = await prisma.product.findUnique({ where: { id: productId } });
  if (!existing) throw notFound("No product with that id.", "PRODUCT_NOT_FOUND");

  const data: Record<string, any> = {};
  for (const field of ["name", "description", "targetSegment"] as const) {
    if (field in input) data[field] = String(input[field] ?? "").trim() || null;
  }
  if ("status" in input) data.status = input.status;
  if ("sortOrder" in input) data.sortOrder = Number(input.sortOrder) || 0;
  if (!Object.keys(data).length) throw invalidState("Nothing to update.", "NO_CHANGES");
  if ("name" in data && !data.name) throw invalidState("Give the product a name.", "NAME_REQUIRED");

  // Retiring a product with live subscriptions would leave customers holding
  // something that no longer exists in the catalogue.
  if (data.status === "RETIRED") {
    const live = await prisma.subscription.count({
      where: { productId, status: { in: ["ACTIVE", "TRIAL", "PAST_DUE"] } },
    });
    if (live > 0) {
      throw invalidState(
        `${existing.name} still has ${live} live subscription${live === 1 ? "" : "s"}. Move them before retiring it.`,
        "PRODUCT_IN_USE",
      );
    }
  }

  const [product] = await prisma.$transaction([
    prisma.product.update({ where: { id: productId }, data }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.PRODUCT_UPDATED,
        resourceType: "Product",
        resourceId: existing.key,
        resourceLabel: existing.name,
        previousValue: { name: existing.name, status: existing.status },
        newValue: data,
      }),
    }),
  ]);
  return product;
};

// ─── Plans ───────────────────────────────────────────────────────────────────

export const createPlan = async (req: any, input: any) => {
  const productId = Number(input.productId);
  const key = input.key?.trim().toUpperCase();
  const name = input.name?.trim();

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw notFound("No product with that id.", "PRODUCT_NOT_FOUND");
  if (!key) throw invalidState("Give the plan a key.", "KEY_REQUIRED");
  if (!name) throw invalidState("Give the plan a name.", "NAME_REQUIRED");

  const existing = await prisma.plan.findUnique({ where: { productId_key: { productId, key } } });
  if (existing) throw conflict(`${product.name} already has a plan with the key ${key}.`, "PLAN_EXISTS");

  const [plan] = await prisma.$transaction([
    prisma.plan.create({
      data: {
        productId,
        key,
        name,
        description: input.description?.trim() || null,
        sortOrder: Number(input.sortOrder) || 0,
        // Pricing is not accepted here. Creating a plan and pricing it are
        // different decisions with different permissions; a plan is born
        // unpriced and PLAN_PRICING_MANAGE sets the terms.
      },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.PLAN_CREATED,
        resourceType: "Plan",
        resourceId: `${product.key}/${key}`,
        resourceLabel: `${product.name} — ${name}`,
        newValue: { productKey: product.key, key, name },
      }),
    }),
  ]);
  return serializePlan(plan);
};

export const updatePlan = async (req: any, planId: number, input: any) => {
  const existing = await prisma.plan.findUnique({
    where: { id: planId },
    include: { product: { select: { key: true, name: true } } },
  });
  if (!existing) throw notFound("No plan with that id.", "PLAN_NOT_FOUND");

  const data: Record<string, any> = {};
  for (const field of ["name", "description", "entitlementNotes"] as const) {
    if (field in input) data[field] = String(input[field] ?? "").trim() || null;
  }
  if ("status" in input) data.status = input.status;
  if ("sortOrder" in input) data.sortOrder = Number(input.sortOrder) || 0;
  for (const field of ["includedLocations", "includedSeats"] as const) {
    if (field in input) {
      const value = input[field];
      // Null is meaningful here — "not specified" rather than "zero included".
      data[field] = value === null || value === "" ? null : Number(value);
    }
  }
  if (!Object.keys(data).length) throw invalidState("Nothing to update.", "NO_CHANGES");
  if ("name" in data && !data.name) throw invalidState("Give the plan a name.", "NAME_REQUIRED");

  if (data.status === "RETIRED") {
    const live = await prisma.subscription.count({
      where: { planId, status: { in: ["ACTIVE", "TRIAL", "PAST_DUE"] } },
    });
    if (live > 0) {
      throw invalidState(
        `${existing.name} still has ${live} live subscription${live === 1 ? "" : "s"}. Move them before retiring it.`,
        "PLAN_IN_USE",
      );
    }
  }

  const [plan] = await prisma.$transaction([
    prisma.plan.update({ where: { id: planId }, data }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.PLAN_UPDATED,
        resourceType: "Plan",
        resourceId: `${existing.product.key}/${existing.key}`,
        resourceLabel: `${existing.product.name} — ${existing.name}`,
        previousValue: { name: existing.name, status: existing.status },
        newValue: data,
      }),
    }),
  ]);
  return serializePlan(plan);
};

/**
 * Pricing, behind its own permission.
 *
 * Separate from `updatePlan` because setting what a plan costs is a commercial
 * decision that belongs to Finance, while editing its description is catalogue
 * maintenance. Both are audited, but a price change is the one that needs to be
 * findable later.
 *
 * Existing subscriptions are deliberately untouched: they carry their own
 * `billingInterval` copied at signature time, so repricing a plan changes what
 * new customers pay and never silently rewrites an agreement already in force.
 */
export const setPlanPricing = async (req: any, planId: number, input: any) => {
  const existing = await prisma.plan.findUnique({
    where: { id: planId },
    include: { product: { select: { key: true, name: true } } },
  });
  if (!existing) throw notFound("No plan with that id.", "PLAN_NOT_FOUND");

  const data: Record<string, any> = {};

  if ("priceAmount" in input) {
    const value = input.priceAmount;
    if (value === null || value === "") {
      data.priceAmount = null;
    } else {
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount < 0) {
        throw invalidState("Enter a price of zero or more, or clear it to leave the plan unpriced.", "INVALID_PRICE");
      }
      data.priceAmount = amount;
    }
  }
  if ("currency" in input) {
    const currency = String(input.currency ?? "").trim().toUpperCase();
    data.currency = currency || null;
    if (currency && !/^[A-Z]{3}$/.test(currency)) {
      throw invalidState("Use a three-letter currency code, such as INR.", "INVALID_CURRENCY");
    }
  }
  if ("billingInterval" in input) {
    const interval = input.billingInterval;
    if (interval && !["MONTHLY", "QUARTERLY", "ANNUAL"].includes(interval)) {
      throw invalidState("That is not a billing interval we support.", "INVALID_INTERVAL");
    }
    data.billingInterval = interval || null;
  }
  if ("trialDays" in input) {
    const value = input.trialDays;
    if (value === null || value === "") {
      data.trialDays = null;
    } else {
      const days = Number(value);
      if (!Number.isInteger(days) || days < 0 || days > 365) {
        throw invalidState("Trial length must be a whole number of days, up to 365.", "INVALID_TRIAL");
      }
      data.trialDays = days;
    }
  }

  if (!Object.keys(data).length) throw invalidState("Nothing to update.", "NO_CHANGES");

  // A price without an interval cannot be normalised to MRR, so it would be
  // silently excluded from every revenue figure. Refusing the half-configured
  // state is better than accepting it and under-reporting.
  const finalAmount = "priceAmount" in data ? data.priceAmount : existing.priceAmount;
  const finalInterval = "billingInterval" in data ? data.billingInterval : existing.billingInterval;
  if (finalAmount !== null && finalAmount !== undefined && !finalInterval) {
    throw invalidState(
      "A price needs a billing interval — otherwise it can't be counted towards MRR.",
      "INTERVAL_REQUIRED",
    );
  }
  if (finalAmount !== null && finalAmount !== undefined) {
    const finalCurrency = "currency" in data ? data.currency : existing.currency;
    if (!finalCurrency) {
      throw invalidState("A price needs a currency.", "CURRENCY_REQUIRED");
    }
  }

  const [plan] = await prisma.$transaction([
    prisma.plan.update({ where: { id: planId }, data }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.PLAN_PRICING_CHANGED,
        resourceType: "Plan",
        resourceId: `${existing.product.key}/${existing.key}`,
        resourceLabel: `${existing.product.name} — ${existing.name}`,
        previousValue: {
          priceAmount: existing.priceAmount === null ? null : Number(existing.priceAmount),
          currency: existing.currency,
          billingInterval: existing.billingInterval,
          trialDays: existing.trialDays,
        },
        newValue: data,
        reason: input.reason ?? null,
      }),
    }),
  ]);

  return serializePlan(plan);
};
