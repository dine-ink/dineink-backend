import { Router } from "express";
import { internalAuth, requirePermission } from "../rbac/internalAuth.middleware";
import { PERMISSIONS as P } from "../rbac/permissions";
import { isJiraConfigured } from "../jira/jira.client";
import { asyncHandler, badRequest } from "../shared/apiError";
import * as service from "./tickets.service";

const router = Router();
router.use(internalAuth);

const ticketId = (req: any) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("That isn't a valid ticket id.", "INVALID_ID");
  return id;
};

router.get(
  "/",
  requirePermission(P.TICKET_VIEW),
  asyncHandler(async (req, res) => {
    const data = await service.listTickets(req.query as any);
    return res.json({ success: true, data });
  }),
);

router.get(
  "/meta",
  requirePermission(P.TICKET_VIEW),
  asyncHandler(async (_req, res) =>
    res.json({
      success: true,
      data: {
        categories: ["PAYMENT", "ORDER", "RESTAURANT", "CUSTOMER", "LOGIN", "QR", "MENU", "ACCOUNT", "TECHNICAL", "OTHER"],
        priorities: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
        statuses: [
          "NEW",
          "TRIAGED",
          "IN_PROGRESS",
          "WAITING_FOR_INFORMATION",
          "ESCALATED_TO_ENGINEERING",
          "ENGINEERING_RESOLVED",
          "VERIFICATION",
          "RESOLVED",
          "CLOSED",
        ],
        jiraConfigured: isJiraConfigured(),
      },
    }),
  ),
);

router.post(
  "/",
  requirePermission(P.TICKET_CREATE),
  asyncHandler(async (req, res) => {
    const data = await service.createTicket(req, req.body ?? {});
    return res.status(201).json({ success: true, data });
  }),
);

router.get(
  "/:id",
  requirePermission(P.TICKET_VIEW),
  asyncHandler(async (req, res) => {
    const data = await service.getTicket(ticketId(req));
    return res.json({ success: true, data });
  }),
);

router.post(
  "/:id/status",
  requirePermission(P.TICKET_UPDATE),
  asyncHandler(async (req, res) => {
    const data = await service.updateTicketStatus(req, ticketId(req), req.body?.status, req.body?.note);
    return res.json({ success: true, data });
  }),
);

router.post(
  "/:id/assign",
  requirePermission(P.TICKET_ASSIGN),
  asyncHandler(async (req, res) => {
    const assigneeId = req.body?.assigneeId === null ? null : Number(req.body?.assigneeId);
    const data = await service.assignTicket(req, ticketId(req), assigneeId || null);
    return res.json({ success: true, data });
  }),
);

router.post(
  "/:id/comments",
  requirePermission(P.TICKET_UPDATE),
  asyncHandler(async (req, res) => {
    const data = await service.addComment(req, ticketId(req), req.body?.body);
    return res.status(201).json({ success: true, data });
  }),
);

router.post(
  "/:id/escalate",
  requirePermission(P.TICKET_ESCALATE),
  asyncHandler(async (req, res) => {
    const data = await service.escalateTicket(req, ticketId(req), req.body ?? {});
    return res.json({ success: true, data });
  }),
);

router.post(
  "/:id/jira",
  requirePermission(P.TICKET_ESCALATE),
  asyncHandler(async (req, res) => {
    const data = await service.linkJiraIssue(req, ticketId(req), req.body?.issueKey);
    return res.json({ success: true, data });
  }),
);

export default router;
