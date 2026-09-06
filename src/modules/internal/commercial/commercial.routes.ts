import { Router } from "express";
import { internalAuth, requirePermission } from "../rbac/internalAuth.middleware";
import { PERMISSIONS as P } from "../rbac/permissions";
import { asyncHandler, badRequest } from "../shared/apiError";
import {
  dateField,
  idField,
  listQuerySchema,
  optionalDate,
  optionalId,
  optionalMoney,
  optionalReason,
  optionalText,
  parseBody,
  parseQuery,
  reasonField,
  shortText,
  z,
} from "../shared/validate";
import * as catalog from "../catalog/catalog.service";
import * as subscriptions from "../subscriptions/subscriptions.service";
import * as billing from "../billing/billing.service";

/**
 * The commercial surface: products, plans, subscriptions and billing.
 *
 * Grouped in one router because they are one story — what we sell, who bought
 * it, and what they owe — but each has its own permissions, and the split
 * between them is deliberate:
 *
 *   PRODUCT_* / PLAN_*        global catalogue configuration
 *   PLAN_PRICING_MANAGE       what a plan costs (Finance, not catalogue admin)
 *   SUBSCRIPTION_*            what one customer bought
 *   INVOICE_* / PAYMENT_*     what one customer owes and has paid
 *
 * Everything customer-specific is account-scoped inside the service.
 */
const router = Router();
router.use(internalAuth);

const numericParam = (req: any, name: string, label: string) => {
  const value = Number(req.params[name]);
  if (!Number.isInteger(value) || value <= 0) throw badRequest(`That is not a valid ${label}.`, "INVALID_ID");
  return value;
};

// ═══ Products ═══════════════════════════════════════════════════════════════

router.get(
  "/products",
  requirePermission(P.PRODUCT_VIEW),
  asyncHandler(async (req, res) =>
    res.json({ success: true, data: await catalog.listProducts(req.query.includeRetired === "true") }),
  ),
);

router.get(
  "/products/:id",
  requirePermission(P.PRODUCT_VIEW),
  asyncHandler(async (req, res) =>
    res.json({ success: true, data: await catalog.getProduct(numericParam(req, "id", "product id")) }),
  ),
);

router.post(
  "/products",
  requirePermission(P.PRODUCT_MANAGE),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        key: shortText(50),
        name: shortText(120),
        description: optionalText(1000),
        targetSegment: optionalText(200),
        sortOrder: z.coerce.number().int().optional(),
      }),
      req.body,
    );
    return res.status(201).json({ success: true, data: await catalog.createProduct(req, body) });
  }),
);

router.patch(
  "/products/:id",
  requirePermission(P.PRODUCT_MANAGE),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        name: shortText(120).optional(),
        description: optionalText(1000),
        targetSegment: optionalText(200),
        status: z.enum(["ACTIVE", "RETIRED"]).optional(),
        sortOrder: z.coerce.number().int().optional(),
      }),
      req.body,
    );
    const product = await catalog.updateProduct(req, numericParam(req, "id", "product id"), body);
    return res.json({ success: true, data: product });
  }),
);

// ═══ Plans ══════════════════════════════════════════════════════════════════

router.get(
  "/plans",
  requirePermission(P.PLAN_VIEW),
  asyncHandler(async (req, res) => {
    const query = parseQuery(
      z.object({
        productId: z.coerce.number().int().positive().optional(),
        includeRetired: z.enum(["true", "false"]).optional(),
      }),
      req.query,
    );
    const plans = await catalog.listPlans({
      productId: query.productId,
      includeRetired: query.includeRetired === "true",
    });
    return res.json({ success: true, data: plans });
  }),
);

router.get(
  "/plans/:id",
  requirePermission(P.PLAN_VIEW),
  asyncHandler(async (req, res) =>
    res.json({ success: true, data: await catalog.getPlan(numericParam(req, "id", "plan id")) }),
  ),
);

router.post(
  "/plans",
  requirePermission(P.PLAN_MANAGE),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        productId: idField,
        key: shortText(50),
        name: shortText(120),
        description: optionalText(1000),
        sortOrder: z.coerce.number().int().optional(),
      }),
      req.body,
    );
    return res.status(201).json({ success: true, data: await catalog.createPlan(req, body) });
  }),
);

router.patch(
  "/plans/:id",
  requirePermission(P.PLAN_MANAGE),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        name: shortText(120).optional(),
        description: optionalText(1000),
        entitlementNotes: optionalText(2000),
        status: z.enum(["ACTIVE", "RETIRED"]).optional(),
        sortOrder: z.coerce.number().int().optional(),
        includedLocations: z.coerce.number().int().nonnegative().nullish(),
        includedSeats: z.coerce.number().int().nonnegative().nullish(),
      }),
      req.body,
    );
    const plan = await catalog.updatePlan(req, numericParam(req, "id", "plan id"), body);
    return res.json({ success: true, data: plan });
  }),
);

/**
 * Pricing is its own endpoint with its own permission. Dineink has not supplied
 * prices, so every plan ships unpriced and this is how they get set when it
 * does — nothing in the codebase guesses a figure.
 */
router.put(
  "/plans/:id/pricing",
  requirePermission(P.PLAN_PRICING_MANAGE),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        priceAmount: optionalMoney,
        currency: optionalText(3),
        billingInterval: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL"]).nullish(),
        trialDays: z.coerce.number().int().min(0).max(365).nullish(),
        reason: optionalReason,
      }),
      req.body,
    );
    const plan = await catalog.setPlanPricing(req, numericParam(req, "id", "plan id"), body);
    return res.json({ success: true, data: plan });
  }),
);

// ═══ Subscriptions ══════════════════════════════════════════════════════════

const subscriptionListSchema = listQuerySchema.extend({
  status: z.string().trim().max(100).optional(),
  productId: z.coerce.number().int().positive().optional(),
  planId: z.coerce.number().int().positive().optional(),
  accountId: z.coerce.number().int().positive().optional(),
  renewalBefore: z.string().trim().optional(),
});

router.get(
  "/subscriptions",
  requirePermission(P.SUBSCRIPTION_VIEW),
  asyncHandler(async (req, res) => {
    const query = parseQuery(subscriptionListSchema, req.query);
    return res.json({ success: true, data: await subscriptions.listSubscriptions(req, query as any) });
  }),
);

router.get(
  "/subscriptions/:id",
  requirePermission(P.SUBSCRIPTION_VIEW),
  asyncHandler(async (req, res) =>
    res.json({
      success: true,
      data: await subscriptions.getSubscription(req, numericParam(req, "id", "subscription id")),
    }),
  ),
);

router.post(
  "/subscriptions",
  requirePermission(P.SUBSCRIPTION_CREATE),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        accountId: idField,
        productId: idField,
        planId: optionalId,
        status: z.enum(["TRIAL", "ACTIVE"]).optional(),
        startDate: dateField,
        trialEndsAt: optionalDate,
        renewalDate: optionalDate,
        currentPeriodStart: optionalDate,
        currentPeriodEnd: optionalDate,
        billingInterval: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL"]).nullish(),
        seats: z.coerce.number().int().positive().nullish(),
        locations: z.coerce.number().int().positive().nullish(),
        notes: optionalText(2000),
      }),
      req.body,
    );
    const subscription = await subscriptions.createSubscription(req, body as any);
    return res.status(201).json({ success: true, data: subscription });
  }),
);

router.patch(
  "/subscriptions/:id",
  requirePermission(P.SUBSCRIPTION_EDIT),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        startDate: optionalDate,
        trialEndsAt: optionalDate,
        renewalDate: optionalDate,
        currentPeriodStart: optionalDate,
        currentPeriodEnd: optionalDate,
        billingInterval: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL"]).nullish(),
        seats: z.coerce.number().int().positive().nullish(),
        locations: z.coerce.number().int().positive().nullish(),
        notes: optionalText(2000),
        reason: optionalReason,
      }),
      req.body,
    );
    const subscription = await subscriptions.updateSubscription(
      req,
      numericParam(req, "id", "subscription id"),
      body,
    );
    return res.json({ success: true, data: subscription });
  }),
);

router.post(
  "/subscriptions/:id/status",
  requirePermission(P.SUBSCRIPTION_LIFECYCLE_MANAGE),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        status: z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "PAUSED", "CANCELLED", "EXPIRED"]),
        reason: optionalReason,
      }),
      req.body,
    );
    const subscription = await subscriptions.setSubscriptionStatus(
      req,
      numericParam(req, "id", "subscription id"),
      body.status,
      body.reason,
    );
    return res.json({ success: true, data: subscription });
  }),
);

router.post(
  "/subscriptions/:id/plan",
  requirePermission(P.SUBSCRIPTION_LIFECYCLE_MANAGE),
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ planId: idField, reason: optionalReason }), req.body);
    const subscription = await subscriptions.changeSubscriptionPlan(
      req,
      numericParam(req, "id", "subscription id"),
      body.planId,
      body.reason,
    );
    return res.json({ success: true, data: subscription });
  }),
);

// ═══ Invoices ═══════════════════════════════════════════════════════════════

const invoiceListSchema = listQuerySchema.extend({
  status: z.string().trim().max(100).optional(),
  accountId: z.coerce.number().int().positive().optional(),
  subscriptionId: z.coerce.number().int().positive().optional(),
  overdue: z.enum(["true", "false"]).optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

router.get(
  "/invoices",
  requirePermission(P.INVOICE_VIEW),
  asyncHandler(async (req, res) => {
    const query = parseQuery(invoiceListSchema, req.query);
    return res.json({ success: true, data: await billing.listInvoices(req, query as any) });
  }),
);

router.get(
  "/invoices/:id",
  requirePermission(P.INVOICE_VIEW),
  asyncHandler(async (req, res) =>
    res.json({ success: true, data: await billing.getInvoice(req, numericParam(req, "id", "invoice id")) }),
  ),
);

router.post(
  "/invoices",
  requirePermission(P.INVOICE_CREATE),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        accountId: idField,
        subscriptionId: optionalId,
        issueDate: optionalDate,
        dueDate: optionalDate,
        periodStart: optionalDate,
        periodEnd: optionalDate,
        currency: optionalText(3),
        taxAmount: optionalMoney,
        taxNotes: optionalText(500),
        notes: optionalText(2000),
        lines: z
          .array(
            z.object({
              description: shortText(300),
              quantity: z.coerce.number().positive().default(1),
              unitAmount: z.coerce.number().nonnegative(),
            }),
          )
          .min(1, "An invoice needs at least one line."),
      }),
      req.body,
    );
    const invoice = await billing.createInvoice(req, body as any);
    return res.status(201).json({ success: true, data: invoice });
  }),
);

router.post(
  "/invoices/:id/issue",
  requirePermission(P.INVOICE_ISSUE),
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ issueDate: optionalDate, dueDate: optionalDate }), req.body);
    const invoice = await billing.issueInvoice(
      req,
      numericParam(req, "id", "invoice id"),
      body.issueDate,
      body.dueDate,
    );
    return res.json({ success: true, data: invoice });
  }),
);

router.post(
  "/invoices/:id/void",
  requirePermission(P.INVOICE_VOID),
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ reason: reasonField }), req.body);
    const invoice = await billing.voidInvoice(req, numericParam(req, "id", "invoice id"), body.reason);
    return res.json({ success: true, data: invoice });
  }),
);

// ═══ Payments ═══════════════════════════════════════════════════════════════

router.get(
  "/payments",
  requirePermission(P.PAYMENT_VIEW),
  asyncHandler(async (req, res) => {
    const query = parseQuery(
      listQuerySchema.extend({
        status: z.string().trim().max(60).optional(),
        accountId: z.coerce.number().int().positive().optional(),
        invoiceId: z.coerce.number().int().positive().optional(),
        from: z.string().trim().optional(),
        to: z.string().trim().optional(),
      }),
      req.query,
    );
    return res.json({ success: true, data: await billing.listPayments(req, query) });
  }),
);

router.post(
  "/payments",
  requirePermission(P.PAYMENT_RECORD),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        accountId: idField,
        invoiceId: optionalId,
        amount: z.coerce.number().positive("Enter a payment amount greater than zero."),
        currency: optionalText(3),
        status: z.enum(["PENDING", "SUCCEEDED", "FAILED"]).optional(),
        method: optionalText(50),
        reference: optionalText(120),
        receivedAt: optionalDate,
        failureReason: optionalText(500),
        notes: optionalText(1000),
      }),
      req.body,
    );
    const payment = await billing.recordPayment(req, body);
    return res.status(201).json({ success: true, data: payment });
  }),
);

// ═══ Credit notes ═══════════════════════════════════════════════════════════

router.get(
  "/credit-notes",
  requirePermission(P.CREDIT_NOTE_VIEW),
  asyncHandler(async (req, res) => {
    const query = parseQuery(
      listQuerySchema.extend({
        accountId: z.coerce.number().int().positive().optional(),
        invoiceId: z.coerce.number().int().positive().optional(),
      }),
      req.query,
    );
    return res.json({ success: true, data: await billing.listCreditNotes(req, query) });
  }),
);

router.post(
  "/credit-notes",
  requirePermission(P.CREDIT_NOTE_ISSUE),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        accountId: idField,
        invoiceId: optionalId,
        amount: z.coerce.number().positive("Enter a credit amount greater than zero."),
        currency: optionalText(3),
        reason: reasonField,
        issuedAt: optionalDate,
      }),
      req.body,
    );
    const note = await billing.issueCreditNote(req, body);
    return res.status(201).json({ success: true, data: note });
  }),
);

export default router;
