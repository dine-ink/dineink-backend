import { Router } from "express";
import { internalAuth, requirePermission } from "../rbac/internalAuth.middleware";
import { PERMISSIONS as P } from "../rbac/permissions";
import { asyncHandler, badRequest } from "../shared/apiError";
import {
  emailField,
  idField,
  listQuerySchema,
  optionalId,
  optionalReason,
  optionalText,
  parseBody,
  parseQuery,
  phoneField,
  shortText,
  z,
} from "../shared/validate";
import * as service from "./accounts.service";

/**
 * Customers — the accounts that buy DineInk.
 *
 * Every route is permission-checked here and scope-checked in the service:
 * `accountWhere(req)` narrows the lists, `assertAccountAccess` guards each
 * by-id read. Both are needed — a list filter does nothing against someone who
 * types an id straight into the URL.
 */
const router = Router();
router.use(internalAuth);

const accountId = (req: any) => {
  const parsed = Number(req.params.id);
  if (!Number.isInteger(parsed) || parsed <= 0) throw badRequest("That is not a valid customer id.", "INVALID_ID");
  return parsed;
};

const listSchema = listQuerySchema.extend({
  status: z.string().trim().max(100).optional(),
  productId: z.coerce.number().int().positive().optional(),
  planId: z.coerce.number().int().positive().optional(),
  subscriptionStatus: z.string().trim().max(100).optional(),
  onboardingStatus: z.string().trim().max(100).optional(),
  ownerId: z.union([z.literal("none"), z.coerce.number().int().positive()]).optional(),
  city: z.string().trim().max(100).optional(),
});

const accountBodySchema = z.object({
  name: shortText(200),
  legalName: optionalText(200),
  status: z.enum(["LEAD", "PROSPECT", "CUSTOMER", "CHURNED"]).optional(),
  ownerId: optionalId,
  billingEmail: emailField,
  billingPhone: phoneField,
  billingAddress: optionalText(500),
  gstNumber: optionalText(32),
  city: optionalText(100),
  state: optionalText(100),
  pincode: optionalText(16),
  website: optionalText(200),
  industrySegment: optionalText(100),
  notes: optionalText(4000),
  salesStageKey: optionalText(50),
});

// A patch may send any subset, so every field becomes optional — but each one
// still has to satisfy its own rule when present.
const accountPatchSchema = accountBodySchema.partial().extend({ reason: optionalReason });

const contactSchema = z.object({
  name: shortText(200),
  email: emailField,
  phone: phoneField,
  designation: optionalText(100),
  isPrimary: z.boolean().optional(),
  notes: optionalText(1000),
});

// ─── List & read ─────────────────────────────────────────────────────────────

router.get(
  "/",
  requirePermission(P.ACCOUNT_VIEW),
  asyncHandler(async (req, res) => {
    const query = parseQuery(listSchema, req.query);
    return res.json({ success: true, data: await service.listAccounts(req, query as any) });
  }),
);

router.get(
  "/filter-options",
  requirePermission(P.ACCOUNT_VIEW),
  asyncHandler(async (req, res) =>
    res.json({ success: true, data: await service.getAccountFilterOptions(req) }),
  ),
);

router.get(
  "/:id",
  requirePermission(P.ACCOUNT_VIEW),
  asyncHandler(async (req, res) =>
    res.json({ success: true, data: await service.getAccount(req, accountId(req)) }),
  ),
);

// ─── Write ───────────────────────────────────────────────────────────────────

router.post(
  "/",
  requirePermission(P.ACCOUNT_CREATE),
  asyncHandler(async (req, res) => {
    const body = parseBody(accountBodySchema, req.body);
    const account = await service.createAccount(req, body as any);
    return res.status(201).json({ success: true, data: account });
  }),
);

router.patch(
  "/:id",
  requirePermission(P.ACCOUNT_EDIT),
  asyncHandler(async (req, res) => {
    const body = parseBody(accountPatchSchema, req.body);
    return res.json({ success: true, data: await service.updateAccount(req, accountId(req), body as any) });
  }),
);

/**
 * Lifecycle moves have their own route and their own permission. Folding them
 * into PATCH would let anyone with ACCOUNT_EDIT churn a customer, and would
 * record the change under a generic "updated" audit action.
 */
router.post(
  "/:id/lifecycle",
  requirePermission(P.ACCOUNT_LIFECYCLE_MANAGE),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        status: z.enum(["LEAD", "PROSPECT", "CUSTOMER", "CHURNED"]),
        reason: optionalReason,
      }),
      req.body,
    );
    const account = await service.setAccountLifecycle(req, accountId(req), body.status, body.reason);
    return res.json({ success: true, data: account });
  }),
);

// ─── Contacts ────────────────────────────────────────────────────────────────

router.get(
  "/:id/contacts",
  requirePermission(P.ACCOUNT_CONTACT_VIEW),
  asyncHandler(async (req, res) =>
    res.json({ success: true, data: await service.listContacts(req, accountId(req)) }),
  ),
);

router.post(
  "/:id/contacts",
  requirePermission(P.ACCOUNT_CONTACT_MANAGE),
  asyncHandler(async (req, res) => {
    const body = parseBody(contactSchema, req.body);
    const contact = await service.createContact(req, accountId(req), body);
    return res.status(201).json({ success: true, data: contact });
  }),
);

router.patch(
  "/:id/contacts/:contactId",
  requirePermission(P.ACCOUNT_CONTACT_MANAGE),
  asyncHandler(async (req, res) => {
    const body = parseBody(contactSchema.partial(), req.body);
    const contact = await service.updateContact(req, accountId(req), Number(req.params.contactId), body);
    return res.json({ success: true, data: contact });
  }),
);

router.delete(
  "/:id/contacts/:contactId",
  requirePermission(P.ACCOUNT_CONTACT_MANAGE),
  asyncHandler(async (req, res) => {
    await service.deleteContact(req, accountId(req), Number(req.params.contactId));
    return res.json({ success: true, data: true });
  }),
);

// ─── Locations ───────────────────────────────────────────────────────────────

router.get(
  "/:id/locations",
  requirePermission(P.LOCATION_VIEW),
  asyncHandler(async (req, res) =>
    res.json({ success: true, data: await service.listLocations(req, accountId(req)) }),
  ),
);

router.post(
  "/:id/locations/:branchId/status",
  requirePermission(P.LOCATION_MANAGE),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        status: z.enum(["ACTIVE", "INACTIVE", "CLOSED"]),
        reason: optionalReason,
      }),
      req.body,
    );
    const branch = await service.setLocationStatus(
      req,
      accountId(req),
      Number(req.params.branchId),
      body.status,
      body.reason,
    );
    return res.json({ success: true, data: branch });
  }),
);

// ─── Assignments ─────────────────────────────────────────────────────────────
//
// Assigning an employee to an account grants them that customer's data, so the
// write side needs its own permission rather than riding on ACCOUNT_EDIT.

router.get(
  "/:id/assignments",
  requirePermission(P.ACCOUNT_VIEW),
  asyncHandler(async (req, res) =>
    res.json({ success: true, data: await service.listAssignments(req, accountId(req)) }),
  ),
);

router.post(
  "/:id/assignments",
  requirePermission(P.ACCOUNT_ASSIGNMENT_MANAGE),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({ employeeId: idField, role: optionalText(50) }),
      req.body,
    );
    const assignment = await service.assignEmployee(req, accountId(req), body.employeeId, body.role);
    return res.status(201).json({ success: true, data: assignment });
  }),
);

router.delete(
  "/:id/assignments/:employeeId",
  requirePermission(P.ACCOUNT_ASSIGNMENT_MANAGE),
  asyncHandler(async (req, res) => {
    await service.unassignEmployee(req, accountId(req), Number(req.params.employeeId));
    return res.json({ success: true, data: true });
  }),
);

export default router;
