import { Router } from "express";
import { internalAuth, requirePermission } from "../rbac/internalAuth.middleware";
import { PERMISSIONS as P } from "../rbac/permissions";
import { asyncHandler, badRequest } from "../shared/apiError";
import {
  idField,
  listQuerySchema,
  optionalDate,
  optionalId,
  optionalMoney,
  optionalReason,
  optionalText,
  parseBody,
  parseQuery,
  shortText,
  z,
} from "../shared/validate";
import * as service from "./sales.service";

/**
 * Sales pipeline.
 *
 * Leads and prospects are not listed here — they are Accounts filtered by
 * lifecycle status, on the Customers screen. This module is only the deals.
 */
const router = Router();
router.use(internalAuth);

const opportunityId = (req: any) => {
  const value = Number(req.params.id);
  if (!Number.isInteger(value) || value <= 0) throw badRequest("That is not a valid opportunity id.", "INVALID_ID");
  return value;
};

router.get(
  "/stages",
  requirePermission(P.OPPORTUNITY_VIEW),
  asyncHandler(async (_req, res) => res.json({ success: true, data: await service.listStages() })),
);

router.get(
  "/pipeline",
  requirePermission(P.OPPORTUNITY_VIEW),
  asyncHandler(async (req, res) => res.json({ success: true, data: await service.getPipeline(req) })),
);

router.get(
  "/opportunities",
  requirePermission(P.OPPORTUNITY_VIEW),
  asyncHandler(async (req, res) => {
    const query = parseQuery(
      listQuerySchema.extend({
        stageId: z.coerce.number().int().positive().optional(),
        accountId: z.coerce.number().int().positive().optional(),
        productId: z.coerce.number().int().positive().optional(),
        ownerId: z.union([z.literal("none"), z.coerce.number().int().positive()]).optional(),
        open: z.enum(["true", "false"]).optional(),
      }),
      req.query,
    );
    return res.json({ success: true, data: await service.listOpportunities(req, query) });
  }),
);

router.get(
  "/opportunities/:id",
  requirePermission(P.OPPORTUNITY_VIEW),
  asyncHandler(async (req, res) =>
    res.json({ success: true, data: await service.getOpportunity(req, opportunityId(req)) }),
  ),
);

router.post(
  "/opportunities",
  requirePermission(P.OPPORTUNITY_MANAGE),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        accountId: idField,
        name: shortText(200),
        stageId: idField,
        ownerId: optionalId,
        productId: optionalId,
        planId: optionalId,
        amount: optionalMoney,
        currency: optionalText(3),
        expectedCloseDate: optionalDate,
        notes: optionalText(4000),
      }),
      req.body,
    );
    return res.status(201).json({ success: true, data: await service.createOpportunity(req, body) });
  }),
);

router.patch(
  "/opportunities/:id",
  requirePermission(P.OPPORTUNITY_MANAGE),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        name: shortText(200).optional(),
        ownerId: optionalId,
        productId: optionalId,
        planId: optionalId,
        amount: optionalMoney,
        currency: optionalText(3),
        expectedCloseDate: optionalDate,
        notes: optionalText(4000),
        lostReason: optionalText(1000),
      }),
      req.body,
    );
    return res.json({ success: true, data: await service.updateOpportunity(req, opportunityId(req), body) });
  }),
);

/**
 * Advancing to a stage flagged `isWon` converts the account to CUSTOMER in the
 * same transaction, so the pipeline and the commercial lifecycle can never
 * disagree about whether someone is a customer.
 */
router.post(
  "/opportunities/:id/stage",
  requirePermission(P.OPPORTUNITY_MANAGE),
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ stageId: idField, reason: optionalReason }), req.body);
    const opportunity = await service.setOpportunityStage(req, opportunityId(req), body.stageId, body.reason);
    return res.json({ success: true, data: opportunity });
  }),
);

export default router;
