import { Router } from "express";
import { internalAuth, requirePermission } from "../rbac/internalAuth.middleware";
import { PERMISSIONS as P } from "../rbac/permissions";
import { isJiraConfigured } from "../jira/jira.client";
import { asyncHandler, badRequest } from "../shared/apiError";
import * as service from "./tickets.service";
import * as attachments from "./attachments.service";

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

// ─── Attachments ─────────────────────────────────────────────────────────────
//
// Files are NOT written into /uploads. That directory is served by
// express.static with no authentication, and a support attachment is usually a
// screenshot of an order or an invoice. These live outside it and come back
// only through the download route below, which re-checks permission and account
// scope every time.

router.get(
  "/:id/attachments",
  requirePermission(P.TICKET_VIEW),
  asyncHandler(async (req, res) =>
    res.json({ success: true, data: await attachments.listAttachments(req, ticketId(req)) }),
  ),
);

/**
 * Upload.
 *
 * multer runs before the handler, so its own failures (too large, wrong type)
 * arrive as an error from the middleware rather than as a thrown ApiError.
 * Wrapping it lets those become the API's normal error shape instead of a
 * generic 500 with an unhelpful message.
 */
router.post(
  "/:id/attachments",
  requirePermission(P.TICKET_ATTACHMENT_MANAGE),
  (req, res, next) => {
    attachments.ticketAttachmentUpload.single("file")(req, res, (error: any) => {
      if (!error) return next();
      const tooLarge = error?.code === "LIMIT_FILE_SIZE";
      return res.status(400).json({
        success: false,
        code: tooLarge ? "FILE_TOO_LARGE" : "INVALID_FILE",
        message: tooLarge
          ? `That file is too large. The limit is ${Math.round(attachments.MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB.`
          : (error?.message ?? "That file couldn't be accepted."),
      });
    });
  },
  asyncHandler(async (req, res) => {
    const data = await attachments.addAttachment(req, ticketId(req), req.file);
    return res.status(201).json({ success: true, data });
  }),
);

/**
 * Download.
 *
 * Streams the bytes; never redirects to a static path and never returns a
 * filesystem location. The attachment is looked up scoped to its ticket, so
 * changing the id in the URL cannot reach another ticket's file.
 */
router.get(
  "/:id/attachments/:attachmentId/download",
  requirePermission(P.TICKET_VIEW),
  asyncHandler(async (req, res) => {
    const attachmentId = Number(req.params.attachmentId);
    if (!Number.isInteger(attachmentId) || attachmentId <= 0) {
      throw badRequest("That is not a valid attachment id.", "INVALID_ID");
    }
    const { attachment, absolutePath } = await attachments.resolveAttachmentForDownload(
      req,
      ticketId(req),
      attachmentId,
    );

    // `attachment` forces a download rather than letting the browser render it
    // inline — a PDF or an HTML-ish text file rendered same-origin is a
    // stored-XSS opportunity, and nothing here needs inline preview.
    res.setHeader("Content-Type", attachment.mimeType ?? "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${attachment.fileName}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.sendFile(absolutePath);
  }),
);

router.delete(
  "/:id/attachments/:attachmentId",
  requirePermission(P.TICKET_ATTACHMENT_MANAGE),
  asyncHandler(async (req, res) => {
    await attachments.deleteAttachment(req, ticketId(req), Number(req.params.attachmentId));
    return res.json({ success: true, data: true });
  }),
);

export default router;
