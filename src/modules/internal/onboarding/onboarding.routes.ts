import { Router } from "express";
import { internalAuth, requirePermission } from "../rbac/internalAuth.middleware";
import { PERMISSIONS as P } from "../rbac/permissions";
import { asyncHandler, badRequest } from "../shared/apiError";
import {
  idField,
  listQuerySchema,
  optionalDate,
  optionalId,
  optionalReason,
  optionalText,
  parseBody,
  parseQuery,
  z,
} from "../shared/validate";
import * as service from "./onboarding.service";

/**
 * Customer onboarding, scoped to accounts.
 *
 * Going live has its own permission (ONBOARDING_GO_LIVE) and its own route,
 * because declaring a customer live is a different act from ticking a checklist
 * item — and the gate that checks the mandatory steps lives behind it.
 */
const router = Router();
router.use(internalAuth);

const onboardingId = (req: any) => {
  const value = Number(req.params.id);
  if (!Number.isInteger(value) || value <= 0) throw badRequest("That is not a valid onboarding id.", "INVALID_ID");
  return value;
};

router.get(
  "/",
  requirePermission(P.ONBOARDING_VIEW),
  asyncHandler(async (req, res) => {
    const query = parseQuery(
      listQuerySchema.extend({
        status: z.string().trim().max(120).optional(),
        accountId: z.coerce.number().int().positive().optional(),
        assignedToId: z.union([z.literal("none"), z.coerce.number().int().positive()]).optional(),
        overdue: z.enum(["true", "false"]).optional(),
      }),
      req.query,
    );
    return res.json({ success: true, data: await service.listOnboardings(req, query) });
  }),
);

/** Column counts for the onboarding board. */
router.get(
  "/counts",
  requirePermission(P.ONBOARDING_VIEW),
  asyncHandler(async (req, res) =>
    res.json({ success: true, data: await service.getOnboardingCounts(req) }),
  ),
);

router.get(
  "/:id",
  requirePermission(P.ONBOARDING_VIEW),
  asyncHandler(async (req, res) =>
    res.json({ success: true, data: await service.getOnboarding(req, onboardingId(req)) }),
  ),
);

router.post(
  "/",
  requirePermission(P.ONBOARDING_MANAGE),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        accountId: idField,
        subscriptionId: optionalId,
        assignedToId: optionalId,
        dueDate: optionalDate,
      }),
      req.body,
    );
    const onboarding = await service.startOnboarding(req, body as any);
    return res.status(201).json({ success: true, data: onboarding });
  }),
);

router.patch(
  "/:id",
  requirePermission(P.ONBOARDING_MANAGE),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({ dueDate: optionalDate, notes: optionalText(4000) }),
      req.body,
    );
    return res.json({ success: true, data: await service.updateOnboarding(req, onboardingId(req), body) });
  }),
);

router.post(
  "/:id/status",
  requirePermission(P.ONBOARDING_MANAGE),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        status: z.enum(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "READY_FOR_GO_LIVE", "COMPLETED"]),
        reason: optionalReason,
      }),
      req.body,
    );
    const onboarding = await service.setOnboardingStatus(req, onboardingId(req), body.status, body.reason);
    return res.json({ success: true, data: onboarding });
  }),
);

router.post(
  "/:id/go-live",
  requirePermission(P.ONBOARDING_GO_LIVE),
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ reason: optionalReason }), req.body);
    const onboarding = await service.goLive(req, onboardingId(req), body.reason);
    return res.json({ success: true, data: onboarding });
  }),
);

router.post(
  "/:id/assign",
  requirePermission(P.ONBOARDING_MANAGE),
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ assignedToId: optionalId }), req.body);
    const onboarding = await service.assignOnboarding(req, onboardingId(req), body.assignedToId);
    return res.json({ success: true, data: onboarding });
  }),
);

router.patch(
  "/:id/tasks/:taskKey",
  requirePermission(P.ONBOARDING_MANAGE),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETE", "BLOCKED", "NOT_APPLICABLE"]).optional(),
        notes: optionalText(2000),
        dueDate: optionalDate,
        assignedToId: optionalId,
      }),
      req.body,
    );
    const task = await service.updateTask(req, onboardingId(req), String(req.params.taskKey), body);
    return res.json({ success: true, data: task });
  }),
);

export default router;
