import prisma from "../../../config/prisma";
import { AUDIT_ACTIONS, auditData } from "../audit/audit.service";
import { invalidState, notFound } from "../shared/apiError";
import { parsePage, parseSort, toPaged } from "../shared/pagination";
import { nextSubscriptionCode } from "../shared/ids";
import { assertAccountAccess, relatedAccountWhere } from "../rbac/scope";

/**
 * Subscriptions — what a customer has actually bought.
 *
 * The join between an Account and the catalogue. This is where "ABC Restaurant
 * Group is on RDS Professional, renewing in March" lives; the plan itself is
 * global configuration and lives in the catalogue.
 *
 * Two decisions worth knowing about:
 *
 *  - **Terms are copied, not referenced.** `billingInterval` is copied from the
 *    plan when the subscription starts. Repricing a plan later changes what new
 *    customers pay and never silently rewrites an agreement already in force.
 *
 *  - **Dates are recorded, not computed.** Dineink has not defined renewal
 *    rules, trial lengths or proration, so nothing here derives a renewal date
 *    from a start date. Whoever creates the subscription enters what was
 *    agreed. The moment those rules exist, they belong in this module.
 */

const SORT_FIELDS = ["startDate", "renewalDate", "status", "createdAt"] as const;

/**
 * Which status moves are permitted.
 *
 * These describe mechanical reality rather than commercial policy: a cancelled
 * subscription cannot quietly become active again (start a new one), and an
 * expired one is finished. Dineink has not defined *when* a subscription should
 * move to PAST_DUE or EXPIRED, so nothing moves it automatically — these are
 * the moves a person is allowed to make.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  TRIAL: ["ACTIVE", "CANCELLED", "EXPIRED", "PAUSED"],
  ACTIVE: ["PAST_DUE", "PAUSED", "CANCELLED", "EXPIRED"],
  PAST_DUE: ["ACTIVE", "PAUSED", "CANCELLED", "EXPIRED"],
  PAUSED: ["ACTIVE", "CANCELLED", "EXPIRED"],
  CANCELLED: [],
  EXPIRED: [],
};

export const assertSubscriptionTransition = (from: string, to: string) => {
  if (from === to) {
    throw invalidState(`This subscription is already ${to.replace(/_/g, " ").toLowerCase()}.`, "STATUS_UNCHANGED");
  }
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw invalidState(
      from === "CANCELLED" || from === "EXPIRED"
        ? `This subscription is ${from.toLowerCase()}. Start a new one instead.`
        : `A ${from.replace(/_/g, " ").toLowerCase()} subscription can't move straight to ${to.replace(/_/g, " ").toLowerCase()}.`,
      "INVALID_SUBSCRIPTION_TRANSITION",
      { from, to, allowed },
    );
  }
};

const serialize = (subscription: any) => ({
  ...subscription,
  plan: subscription.plan
    ? {
        ...subscription.plan,
        priceAmount:
          subscription.plan.priceAmount === null || subscription.plan.priceAmount === undefined
            ? null
            : Number(subscription.plan.priceAmount),
      }
    : null,
});

export interface SubscriptionListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  productId?: number;
  planId?: number;
  accountId?: number;
  renewalBefore?: string;
  sortBy?: string;
  sortDir?: string;
}

export const listSubscriptions = async (req: any, query: SubscriptionListQuery) => {
  const page = parsePage(query);
  const sort = parseSort(query, SORT_FIELDS, "startDate");

  const filters: any[] = [relatedAccountWhere(req)];

  if (query.status) filters.push({ status: { in: String(query.status).split(",") as any } });
  if (query.productId) filters.push({ productId: Number(query.productId) });
  if (query.planId) filters.push({ planId: Number(query.planId) });
  if (query.accountId) filters.push({ accountId: Number(query.accountId) });
  if (query.renewalBefore) filters.push({ renewalDate: { lte: new Date(query.renewalBefore) } });

  const term = query.search?.trim();
  if (term) {
    filters.push({
      OR: [
        { subscriptionCode: { contains: term, mode: "insensitive" } },
        { account: { name: { contains: term, mode: "insensitive" } } },
        { account: { accountCode: { contains: term, mode: "insensitive" } } },
      ],
    });
  }

  const where = { AND: filters };

  const [rows, total] = await Promise.all([
    prisma.subscription.findMany({
      where,
      orderBy: { [sort.field]: sort.direction },
      skip: page.skip,
      take: page.take,
      include: {
        account: { select: { id: true, accountCode: true, name: true, status: true } },
        product: { select: { id: true, key: true, name: true } },
        plan: { select: { id: true, key: true, name: true, priceAmount: true, currency: true } },
      },
    }),
    prisma.subscription.count({ where }),
  ]);

  return toPaged(rows.map(serialize), total, page);
};

export const getSubscription = async (req: any, subscriptionId: number) => {
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      account: { select: { id: true, accountCode: true, name: true, status: true } },
      product: { select: { id: true, key: true, name: true } },
      plan: true,
      events: {
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { actor: { select: { id: true, name: true } } },
      },
      invoices: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          invoiceNo: true,
          status: true,
          issueDate: true,
          dueDate: true,
          total: true,
          amountPaid: true,
          currency: true,
        },
      },
      onboardings: { select: { id: true, status: true } },
    },
  });
  if (!subscription) throw notFound("No subscription with that id.", "SUBSCRIPTION_NOT_FOUND");

  // Scope is checked against the owning account, not the subscription — the
  // subscription is only reachable through a customer the caller may see.
  await assertAccountAccess(req, subscription.accountId);

  return {
    ...serialize(subscription),
    invoices: subscription.invoices.map((invoice) => ({
      ...invoice,
      total: Number(invoice.total),
      amountPaid: Number(invoice.amountPaid),
    })),
    allowedTransitions: ALLOWED_TRANSITIONS[subscription.status] ?? [],
  };
};

export interface CreateSubscriptionInput {
  accountId: number;
  productId: number;
  planId?: number | null;
  status?: string;
  startDate: Date;
  trialEndsAt?: Date | null;
  renewalDate?: Date | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  billingInterval?: string | null;
  seats?: number | null;
  locations?: number | null;
  notes?: string | null;
}

export const createSubscription = async (req: any, input: CreateSubscriptionInput) => {
  await assertAccountAccess(req, input.accountId);

  const [account, product] = await Promise.all([
    prisma.account.findUnique({ where: { id: input.accountId }, select: { id: true, name: true, status: true } }),
    prisma.product.findUnique({
      where: { id: input.productId },
      include: { plans: { where: { status: "ACTIVE" } } },
    }),
  ]);
  if (!account) throw notFound("No customer with that id.", "ACCOUNT_NOT_FOUND");
  if (!product) throw notFound("No product with that id.", "PRODUCT_NOT_FOUND");
  if (product.status !== "ACTIVE") {
    throw invalidState(`${product.name} is retired and can't be sold.`, "PRODUCT_RETIRED");
  }

  // A product with plans requires one; a product without plans must not be
  // given one. Both directions matter — RDS without a plan is meaningless, and
  // Dot with an RDS plan attached is a data error nobody would notice later.
  let plan = null;
  if (product.plans.length > 0) {
    if (!input.planId) {
      throw invalidState(
        `${product.name} is sold by plan — choose ${product.plans.map((p) => p.name).join(" or ")}.`,
        "PLAN_REQUIRED",
      );
    }
    plan = product.plans.find((p) => p.id === Number(input.planId)) ?? null;
    if (!plan) {
      throw invalidState(`That plan doesn't belong to ${product.name}.`, "PLAN_PRODUCT_MISMATCH");
    }
  } else if (input.planId) {
    throw invalidState(`${product.name} has no plans, so one can't be selected.`, "PRODUCT_HAS_NO_PLANS");
  }

  const status = (input.status ?? "TRIAL") as any;

  // The interval is copied from the plan when the caller didn't state one, so
  // the agreement records its own terms rather than following the catalogue.
  const billingInterval = (input.billingInterval ?? plan?.billingInterval ?? null) as any;

  const subscription = await prisma.$transaction(async (tx) => {
    const created = await tx.subscription.create({
      data: {
        subscriptionCode: await nextSubscriptionCode(tx),
        accountId: input.accountId,
        productId: input.productId,
        planId: plan?.id ?? null,
        status,
        startDate: input.startDate,
        billingInterval,
        trialEndsAt: input.trialEndsAt ?? null,
        renewalDate: input.renewalDate ?? null,
        currentPeriodStart: input.currentPeriodStart ?? null,
        currentPeriodEnd: input.currentPeriodEnd ?? null,
        seats: input.seats ?? null,
        locations: input.locations ?? null,
        notes: input.notes ?? null,
        createdById: req.internal.id,
      },
    });

    await tx.subscriptionEvent.create({
      data: {
        subscriptionId: created.id,
        type: "CREATED",
        toValue: status,
        message: `${product.name}${plan ? ` — ${plan.name}` : ""}`,
        actorId: req.internal.id,
      },
    });

    await tx.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.SUBSCRIPTION_CREATED,
        resourceType: "Subscription",
        resourceId: created.id,
        resourceLabel: `${created.subscriptionCode} — ${account.name}`,
        newValue: {
          account: account.name,
          product: product.key,
          plan: plan?.key ?? null,
          status,
          startDate: input.startDate,
        },
      }),
    });

    return created;
  });

  return subscription;
};

const EDITABLE_FIELDS = [
  "startDate",
  "trialEndsAt",
  "renewalDate",
  "currentPeriodStart",
  "currentPeriodEnd",
  "billingInterval",
  "seats",
  "locations",
  "notes",
] as const;

export const updateSubscription = async (req: any, subscriptionId: number, input: Record<string, any>) => {
  const existing = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { account: { select: { name: true } } },
  });
  if (!existing) throw notFound("No subscription with that id.", "SUBSCRIPTION_NOT_FOUND");
  await assertAccountAccess(req, existing.accountId);

  // Status and plan are absent by design: each has its own route, its own
  // permission and its own audit action, so neither can be changed through the
  // general edit endpoint.
  const data: Record<string, any> = {};
  const previous: Record<string, any> = {};
  for (const field of EDITABLE_FIELDS) {
    if (!(field in input)) continue;
    data[field] = input[field] ?? null;
    previous[field] = (existing as any)[field];
  }
  if (!Object.keys(data).length) throw invalidState("Nothing to update.", "NO_CHANGES");

  const [updated] = await prisma.$transaction([
    prisma.subscription.update({ where: { id: subscriptionId }, data }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.SUBSCRIPTION_UPDATED,
        resourceType: "Subscription",
        resourceId: subscriptionId,
        resourceLabel: `${existing.subscriptionCode} — ${existing.account.name}`,
        previousValue: previous,
        newValue: data,
        reason: input.reason ?? null,
      }),
    }),
  ]);
  return updated;
};

export const setSubscriptionStatus = async (
  req: any,
  subscriptionId: number,
  status: string,
  reason?: string | null,
) => {
  const existing = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { account: { select: { name: true } } },
  });
  if (!existing) throw notFound("No subscription with that id.", "SUBSCRIPTION_NOT_FOUND");
  await assertAccountAccess(req, existing.accountId);

  assertSubscriptionTransition(existing.status, status);

  const data: Record<string, any> = { status: status as any };
  if (status === "CANCELLED") {
    if (!reason?.trim()) throw invalidState("Cancelling a subscription needs a reason.", "REASON_REQUIRED");
    data.cancelledAt = new Date();
    data.cancellationReason = reason.trim();
    data.endedAt = new Date();
  }
  if (status === "EXPIRED") data.endedAt = new Date();
  if (status === "ACTIVE") {
    // Re-activating from PAST_DUE or PAUSED clears the closure fields, which
    // would otherwise leave a live subscription carrying a cancellation date.
    data.cancelledAt = null;
    data.cancellationReason = null;
    data.endedAt = null;
  }

  const [updated] = await prisma.$transaction([
    prisma.subscription.update({ where: { id: subscriptionId }, data }),
    prisma.subscriptionEvent.create({
      data: {
        subscriptionId,
        type: status === "CANCELLED" ? "CANCELLED" : "STATUS_CHANGED",
        fromValue: existing.status,
        toValue: status,
        message: reason?.trim() || null,
        actorId: req.internal.id,
      },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action:
          status === "CANCELLED" ? AUDIT_ACTIONS.SUBSCRIPTION_CANCELLED : AUDIT_ACTIONS.SUBSCRIPTION_STATUS_CHANGED,
        resourceType: "Subscription",
        resourceId: subscriptionId,
        resourceLabel: `${existing.subscriptionCode} — ${existing.account.name}`,
        previousValue: { status: existing.status },
        newValue: { status },
        reason: reason ?? null,
      }),
    }),
  ]);

  return updated;
};

/**
 * Upgrade or downgrade.
 *
 * Records the move; it deliberately does not compute proration, a credit or a
 * new invoice, because Dineink has not defined any of those rules. The event
 * and the audit entry make the change findable, and billing follows separately
 * once the policy exists.
 */
export const changeSubscriptionPlan = async (
  req: any,
  subscriptionId: number,
  planId: number,
  reason?: string | null,
) => {
  const existing = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      account: { select: { name: true } },
      product: { select: { id: true, name: true } },
      plan: { select: { id: true, key: true, name: true } },
    },
  });
  if (!existing) throw notFound("No subscription with that id.", "SUBSCRIPTION_NOT_FOUND");
  await assertAccountAccess(req, existing.accountId);

  if (existing.status === "CANCELLED" || existing.status === "EXPIRED") {
    throw invalidState(
      `This subscription is ${existing.status.toLowerCase()}. Start a new one instead of changing its plan.`,
      "SUBSCRIPTION_CLOSED",
    );
  }

  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw notFound("No plan with that id.", "PLAN_NOT_FOUND");
  if (plan.productId !== existing.productId) {
    throw invalidState(
      `That plan belongs to a different product. Moving between products means a new subscription.`,
      "PLAN_PRODUCT_MISMATCH",
    );
  }
  if (plan.status !== "ACTIVE") throw invalidState(`${plan.name} is retired.`, "PLAN_RETIRED");
  if (existing.planId === planId) throw invalidState(`Already on ${plan.name}.`, "PLAN_UNCHANGED");

  const [updated] = await prisma.$transaction([
    prisma.subscription.update({
      where: { id: subscriptionId },
      data: { planId, billingInterval: plan.billingInterval ?? existing.billingInterval },
    }),
    prisma.subscriptionEvent.create({
      data: {
        subscriptionId,
        type: "PLAN_CHANGED",
        fromValue: existing.plan?.name ?? null,
        toValue: plan.name,
        message: reason?.trim() || null,
        actorId: req.internal.id,
      },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.SUBSCRIPTION_PLAN_CHANGED,
        resourceType: "Subscription",
        resourceId: subscriptionId,
        resourceLabel: `${existing.subscriptionCode} — ${existing.account.name}`,
        previousValue: { plan: existing.plan?.key ?? null },
        newValue: { plan: plan.key },
        reason: reason ?? null,
      }),
    }),
  ]);

  return updated;
};

/** Every subscription an account has ever held, for the account timeline. */
export const listAccountSubscriptions = async (req: any, accountId: number) => {
  await assertAccountAccess(req, accountId);
  const rows = await prisma.subscription.findMany({
    where: { accountId },
    orderBy: { startDate: "desc" },
    include: {
      product: { select: { id: true, key: true, name: true } },
      plan: { select: { id: true, key: true, name: true, priceAmount: true, currency: true } },
      _count: { select: { invoices: true } },
    },
  });
  return rows.map(serialize);
};
