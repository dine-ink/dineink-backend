import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";
import prisma from "../../../config/prisma";
import { AUDIT_ACTIONS, auditData, recordAudit } from "../audit/audit.service";
import { badRequest, invalidState, notFound } from "../shared/apiError";
import { assertAccountAccess } from "../rbac/scope";

/**
 * Support ticket attachments.
 *
 * The model already existed; nothing could write to it. Adding upload meant
 * deciding where the bytes live, and the existing answer was wrong for this
 * case:
 *
 *   `/uploads` is served by express.static with NO authentication. Anything
 *   written there is world-readable to anyone who can guess a filename, and a
 *   support attachment is typically a screenshot of an order, an invoice, or a
 *   diner's details. Those must not sit behind a guessable URL.
 *
 * So attachments go in a directory that is never statically served, and come
 * back only through `streamAttachment`, which re-checks the caller's permission
 * and account scope on every request. The stored filename is 32 random bytes:
 * even if the directory were exposed by accident, nothing is enumerable.
 *
 * The client's filename is kept for display only and never touches the disk
 * path — "../../server.js" is a filename someone will eventually send.
 */

// Deliberately a sibling of `uploads`, not inside it, so no future
// `express.static("/uploads")` can serve these by accident.
const ATTACHMENT_ROOT = path.resolve(
  process.env.TICKET_ATTACHMENT_DIR ?? path.join(__dirname, "../../../../secure-uploads/tickets"),
);

const ensureRoot = () => {
  if (!fs.existsSync(ATTACHMENT_ROOT)) {
    fs.mkdirSync(ATTACHMENT_ROOT, { recursive: true });
  }
};

/**
 * What support actually attaches: screenshots, PDFs of an invoice a customer
 * disputed, occasionally a CSV of failing rows. Everything executable or
 * script-bearing is refused — including SVG, which is an XSS vector when
 * served back to a browser.
 */
const ALLOWED_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
};

export const MAX_ATTACHMENT_BYTES = Number(process.env.TICKET_ATTACHMENT_MAX_BYTES ?? 10 * 1024 * 1024);
export const MAX_ATTACHMENTS_PER_TICKET = Number(process.env.TICKET_ATTACHMENT_MAX_COUNT ?? 20);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureRoot();
    cb(null, ATTACHMENT_ROOT);
  },
  filename: (_req, file, cb) => {
    // Never derived from the client's name, and not sequential either: a
    // predictable name is a hole the moment the directory is exposed.
    const ext = ALLOWED_MIME[file.mimetype] ?? ".bin";
    cb(null, `${crypto.randomBytes(32).toString("hex")}${ext}`);
  },
});

export const ticketAttachmentUpload = multer({
  storage,
  limits: {
    fileSize: MAX_ATTACHMENT_BYTES,
    files: 1,
    // Without this, a request with thousands of tiny fields is a cheap way to
    // burn memory before the size limit ever applies.
    fields: 10,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME[file.mimetype]) {
      cb(
        new Error(
          `That file type isn't allowed. Attach an image, PDF, text, CSV or spreadsheet.`,
        ),
      );
      return;
    }
    cb(null, true);
  },
});

/**
 * The account a ticket belongs to, for scoping.
 *
 * A ticket with no account — raised before the commercial model, or about
 * something not customer-specific — is reachable only by a caller with global
 * scope. An unowned ticket must not become a door into arbitrary attachments.
 */
const assertTicketAccess = async (req: any, ticketId: number) => {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, ticketNo: true, accountId: true, status: true },
  });
  if (!ticket) throw notFound("No ticket with that number.", "TICKET_NOT_FOUND");

  if (ticket.accountId) {
    await assertAccountAccess(req, ticket.accountId);
  } else if (req.internal?.accountScope !== "ALL_ACCOUNTS") {
    throw notFound("No ticket with that number.", "TICKET_NOT_FOUND");
  }

  return ticket;
};

export const listAttachments = async (req: any, ticketId: number) => {
  await assertTicketAccess(req, ticketId);
  const rows = await prisma.supportTicketAttachment.findMany({
    where: { ticketId },
    orderBy: { createdAt: "desc" },
  });

  // filePath is deliberately not returned. The client addresses an attachment
  // by id and gets bytes from the download route; it has no reason to know
  // where anything sits on disk, and telling it invites someone to try.
  return rows.map((row) => ({
    id: row.id,
    ticketId: row.ticketId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    size: row.size,
    uploadedById: row.uploadedById,
    createdAt: row.createdAt,
  }));
};

export const addAttachment = async (
  req: any,
  ticketId: number,
  file: Express.Multer.File | undefined,
) => {
  if (!file) throw badRequest("Choose a file to attach.", "FILE_REQUIRED");

  // Every failure past this point must remove the file multer already wrote —
  // otherwise a rejected upload still costs disk.
  const cleanUp = () => {
    fs.promises.unlink(file.path).catch(() => undefined);
  };

  try {
    const ticket = await assertTicketAccess(req, ticketId);

    if (ticket.status === "CLOSED") {
      throw invalidState(
        `${ticket.ticketNo} is closed. Reopen it before attaching anything.`,
        "TICKET_CLOSED",
      );
    }

    const existing = await prisma.supportTicketAttachment.count({ where: { ticketId } });
    if (existing >= MAX_ATTACHMENTS_PER_TICKET) {
      throw invalidState(
        `${ticket.ticketNo} already has ${MAX_ATTACHMENTS_PER_TICKET} attachments.`,
        "TOO_MANY_ATTACHMENTS",
      );
    }

    // Store only the basename. Persisting an absolute path would bake this
    // machine's layout into the database and give a later bug something to
    // traverse from.
    const storedName = path.basename(file.path);

    const attachment = await prisma.$transaction(async (tx) => {
      const created = await tx.supportTicketAttachment.create({
        data: {
          ticketId,
          fileName: sanitiseDisplayName(file.originalname),
          filePath: storedName,
          mimeType: file.mimetype,
          size: file.size,
          uploadedById: req.internal.id,
        },
      });

      await tx.supportTicketEvent.create({
        data: {
          ticketId,
          actorId: req.internal.id,
          type: "ATTACHMENT_ADDED",
          message: created.fileName,
        },
      });

      await tx.internalAuditLog.create({
        data: auditData(req, {
          action: AUDIT_ACTIONS.TICKET_ATTACHMENT_ADDED,
          resourceType: "SupportTicketAttachment",
          resourceId: created.id,
          resourceLabel: `${ticket.ticketNo} — ${created.fileName}`,
          newValue: { fileName: created.fileName, mimeType: created.mimeType, size: created.size },
        }),
      });

      return created;
    });

    return {
      id: attachment.id,
      ticketId: attachment.ticketId,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      uploadedById: attachment.uploadedById,
      createdAt: attachment.createdAt,
    };
  } catch (error) {
    cleanUp();
    throw error;
  }
};

/**
 * Resolves an attachment to a path on disk, after checking the caller may have
 * it.
 *
 * The resolved path is verified to sit inside ATTACHMENT_ROOT before anything
 * is opened. `filePath` should only ever be a random basename this module
 * generated, but a stored value is still input — if a row were ever written
 * with "../../.env", the containment check is what stops it being served.
 */
export const resolveAttachmentForDownload = async (req: any, ticketId: number, attachmentId: number) => {
  await assertTicketAccess(req, ticketId);

  const attachment = await prisma.supportTicketAttachment.findFirst({
    where: { id: attachmentId, ticketId },
  });
  // Scoped by ticketId as well as id, so changing the attachment id in the URL
  // cannot reach another ticket's file even when both tickets are visible.
  if (!attachment) throw notFound("No attachment with that id.", "ATTACHMENT_NOT_FOUND");

  const resolved = path.resolve(ATTACHMENT_ROOT, path.basename(attachment.filePath));
  if (!resolved.startsWith(ATTACHMENT_ROOT + path.sep) && resolved !== ATTACHMENT_ROOT) {
    throw notFound("No attachment with that id.", "ATTACHMENT_NOT_FOUND");
  }
  if (!fs.existsSync(resolved)) {
    throw notFound("That file is no longer available.", "ATTACHMENT_MISSING");
  }

  // Downloading someone's evidence is a data-access event, so it is recorded
  // the same way an unmasked PII view is.
  await recordAudit(req, {
    action: AUDIT_ACTIONS.TICKET_ATTACHMENT_DOWNLOADED,
    resourceType: "SupportTicketAttachment",
    resourceId: attachment.id,
    resourceLabel: attachment.fileName,
  });

  return { attachment, absolutePath: resolved };
};

export const deleteAttachment = async (req: any, ticketId: number, attachmentId: number) => {
  const ticket = await assertTicketAccess(req, ticketId);

  const attachment = await prisma.supportTicketAttachment.findFirst({
    where: { id: attachmentId, ticketId },
  });
  if (!attachment) throw notFound("No attachment with that id.", "ATTACHMENT_NOT_FOUND");

  await prisma.$transaction(async (tx) => {
    await tx.supportTicketAttachment.delete({ where: { id: attachment.id } });
    await tx.supportTicketEvent.create({
      data: {
        ticketId,
        actorId: req.internal.id,
        type: "ATTACHMENT_REMOVED",
        message: attachment.fileName,
      },
    });
    await tx.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.TICKET_ATTACHMENT_DELETED,
        resourceType: "SupportTicketAttachment",
        resourceId: attachment.id,
        resourceLabel: `${ticket.ticketNo} — ${attachment.fileName}`,
        previousValue: { fileName: attachment.fileName, size: attachment.size },
      }),
    });
  });

  // The row goes first and the file after: an orphaned file wastes disk, an
  // orphaned row breaks the ticket page. Failing to unlink is logged, not
  // raised — the attachment is already gone as far as anyone can tell.
  const resolved = path.resolve(ATTACHMENT_ROOT, path.basename(attachment.filePath));
  if (resolved.startsWith(ATTACHMENT_ROOT)) {
    fs.promises
      .unlink(resolved)
      .catch((error) => console.error("[attachments] could not remove file", resolved, error?.message));
  }

  return true;
};

/**
 * A display name safe to put in a Content-Disposition header and in HTML.
 *
 * Strips any path component and the characters that would let a name break out
 * of the header. Never used to build a filesystem path — that comes from the
 * generated random name — this is purely what the employee sees.
 */
export const sanitiseDisplayName = (raw: string): string => {
  const base = path.basename(raw || "attachment");
  const cleaned = base.replace(/[\r\n"\\]/g, "").trim();
  return (cleaned || "attachment").slice(0, 200);
};

export const attachmentRoot = () => ATTACHMENT_ROOT;
