import prisma from "../../../config/prisma";
import { relatedAccountWhere } from "../rbac/scope";
import { AUDIT_ACTIONS, auditData } from "../audit/audit.service";
import { buildJiraUrl, createJiraIssue, fetchJiraIssue, isJiraConfigured } from "../jira/jira.client";
import { queueJiraSync } from "../../../jobs/handlers/syncJiraIssue";
import { ApiError, invalidState, notFound } from "../shared/apiError";
import { ticketNoForId } from "../shared/ids";
import { parsePage, parseSort, toPaged } from "../shared/pagination";

/**
 * Support tickets — the bridge between operations/support and engineering.
 *
 * A ticket is the *operational* record of something a restaurant or customer
 * reported. It links to the entities involved by id, but the links grant
 * nothing: opening the linked order still goes through the orders endpoint and
 * is still checked against the caller's permissions. That matters, because a
 * ticket is the one place in the console where an employee can be handed a
 * pointer to a record they might not otherwise be allowed to see.
 */

const TICKET_STATUSES = [
  "NEW",
  "TRIAGED",
  "IN_PROGRESS",
  "WAITING_FOR_INFORMATION",
  "ESCALATED_TO_ENGINEERING",
  "ENGINEERING_RESOLVED",
  "VERIFICATION",
  "RESOLVED",
  "CLOSED",
] as const;

type TicketStatus = (typeof TICKET_STATUSES)[number];

const OPEN_STATUSES: TicketStatus[] = [
  "NEW",
  "TRIAGED",
  "IN_PROGRESS",
  "WAITING_FOR_INFORMATION",
  "ESCALATED_TO_ENGINEERING",
  "ENGINEERING_RESOLVED",
  "VERIFICATION",
];

/**
 * Which statuses can follow which.
 *
 * Unlike order state — where the rules live in the POS and this app has no
 * business inventing them — a support ticket's lifecycle *is* owned by this
 * application, so it's enforced here. The shape follows the workflow in the
 * brief: work can always be abandoned to CLOSED, a resolution can be reopened
 * if verification fails, and ESCALATED_TO_ENGINEERING is reached through the
 * escalate action rather than by setting the status directly.
 */
const ALLOWED_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  NEW: ["TRIAGED", "IN_PROGRESS", "WAITING_FOR_INFORMATION", "RESOLVED", "CLOSED"],
  TRIAGED: ["IN_PROGRESS", "WAITING_FOR_INFORMATION", "RESOLVED", "CLOSED"],
  IN_PROGRESS: ["WAITING_FOR_INFORMATION", "VERIFICATION", "RESOLVED", "CLOSED"],
  WAITING_FOR_INFORMATION: ["IN_PROGRESS", "TRIAGED", "RESOLVED", "CLOSED"],
  ESCALATED_TO_ENGINEERING: ["ENGINEERING_RESOLVED", "WAITING_FOR_INFORMATION", "CLOSED"],
  ENGINEERING_RESOLVED: ["VERIFICATION", "IN_PROGRESS", "RESOLVED", "CLOSED"],
  VERIFICATION: ["RESOLVED", "IN_PROGRESS", "CLOSED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
};

export const assertTicketTransition = (from: TicketStatus, to: TicketStatus) => {
  if (from === to) throw invalidState(`This ticket is already ${to.replace(/_/g, " ").toLowerCase()}.`, "STATUS_UNCHANGED");
  if (to === "ESCALATED_TO_ENGINEERING") {
    throw invalidState(
      "Use Escalate to engineering — it captures the technical context and raises the Jira issue.",
      "USE_ESCALATE_ACTION",
    );
  }
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw invalidState(
      from === "CLOSED"
        ? "This ticket is closed. Raise a new ticket if the problem is back."
        : `A ${from.replace(/_/g, " ").toLowerCase()} ticket can't move straight to ${to.replace(/_/g, " ").toLowerCase()}.`,
      "INVALID_TICKET_TRANSITION",
      { from, to, allowed },
    );
  }
};

const TICKET_SORT_FIELDS = ["createdAt", "updatedAt", "priority", "status"] as const;

export interface TicketListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  priority?: string;
  category?: string;
  assignedToId?: number | "none";
  createdById?: number;
  restaurantId?: number;
  open?: string;
  sortBy?: string;
  sortDir?: string;
}

export const listTickets = async (query: TicketListQuery) => {
  const page = parsePage(query);
  const sort = parseSort(query, TICKET_SORT_FIELDS, "createdAt");

  const filters: any[] = [];
  if (query.search?.trim()) {
    const term = query.search.trim();
    filters.push({
      OR: [
        { ticketNo: { contains: term, mode: "insensitive" } },
        { title: { contains: term, mode: "insensitive" } },
        { jiraIssueKey: { contains: term, mode: "insensitive" } },
      ],
    });
  }
  // Comma-separated so the dashboard alerts can deep-link straight into a
  // filtered list ("high-priority tickets open").
  if (query.status) filters.push({ status: { in: String(query.status).split(",") } });
  if (query.priority) filters.push({ priority: { in: String(query.priority).split(",") } });
  if (query.category) filters.push({ category: { in: String(query.category).split(",") } });
  if (query.restaurantId) filters.push({ restaurantId: Number(query.restaurantId) });
  if (query.createdById) filters.push({ createdById: Number(query.createdById) });
  if (query.assignedToId === "none") filters.push({ assignedToId: null });
  else if (query.assignedToId) filters.push({ assignedToId: Number(query.assignedToId) });
  if (query.open === "true") filters.push({ status: { in: OPEN_STATUSES } });

  const where = filters.length ? { AND: filters } : {};

  const [rows, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      orderBy: { [sort.field]: sort.direction },
      skip: page.skip,
      take: page.take,
      select: {
        id: true,
        ticketNo: true,
        title: true,
        category: true,
        priority: true,
        status: true,
        restaurantId: true,
        customerId: true,
        billId: true,
        jiraIssueKey: true,
        jiraStatus: true,
        createdAt: true,
        updatedAt: true,
        createdBy: { select: { id: true, name: true, email: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.supportTicket.count({ where }),
  ]);

  // Restaurant names are resolved in one query for the page rather than joined
  // per row — SupportTicket.restaurantId is deliberately not a foreign key, so
  // there's no relation to include (see the schema comment).
  const restaurantIds = [...new Set(rows.map((r) => r.restaurantId).filter(Boolean))] as number[];
  const restaurants = restaurantIds.length
    ? await prisma.restaurant.findMany({
        where: { id: { in: restaurantIds } },
        select: { id: true, name: true },
      })
    : [];
  const restaurantById = new Map(restaurants.map((r) => [r.id, r]));

  return toPaged(
    rows.map((row) => ({
      ...row,
      restaurant: row.restaurantId ? restaurantById.get(row.restaurantId) ?? null : null,
      jiraUrl: row.jiraIssueKey ? buildJiraUrl(row.jiraIssueKey) : null,
    })),
    total,
    page,
  );
};

export interface CreateTicketInput {
  title: string;
  description: string;
  category: string;
  priority?: string;
  restaurantId?: number | null;
  customerId?: number | null;
  billId?: number | null;
  runningOrderId?: number | null;
  errorCode?: string | null;
  correlationId?: string | null;
  environment?: string | null;
  assignedToId?: number | null;
}

export const createTicket = async (req: any, input: CreateTicketInput) => {
  if (!input.title?.trim()) throw invalidState("Give the ticket a title.", "TITLE_REQUIRED");
  if (!input.description?.trim()) throw invalidState("Describe what happened.", "DESCRIPTION_REQUIRED");
  if (!input.category) throw invalidState("Choose an issue type.", "CATEGORY_REQUIRED");

  // Linked entities are validated before the ticket is created — a ticket
  // pointing at an order that doesn't exist wastes the next person's time.
  if (input.restaurantId) {
    const exists = await prisma.restaurant.count({ where: { id: Number(input.restaurantId) } });
    if (!exists) throw notFound("That restaurant doesn't exist.", "RESTAURANT_NOT_FOUND");
  }
  if (input.billId) {
    const exists = await prisma.bill.count({ where: { id: Number(input.billId) } });
    if (!exists) throw notFound("That order doesn't exist.", "ORDER_NOT_FOUND");
  }
  if (input.customerId) {
    const exists = await prisma.customer.count({ where: { id: Number(input.customerId) } });
    if (!exists) throw notFound("That customer doesn't exist.", "CUSTOMER_NOT_FOUND");
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.supportTicket.create({
      data: {
        // Placeholder replaced immediately below — ticketNo is derived from the
        // row's own id, which isn't known until the insert has happened, and the
        // column is unique so it can't be left empty even briefly outside this
        // transaction.
        ticketNo: `PENDING-${Date.now()}`,
        title: input.title.trim(),
        description: input.description.trim(),
        category: input.category as any,
        priority: (input.priority ?? "MEDIUM") as any,
        status: "NEW",
        createdById: req.internal.id,
        assignedToId: input.assignedToId ? Number(input.assignedToId) : null,
        restaurantId: input.restaurantId ? Number(input.restaurantId) : null,
        customerId: input.customerId ? Number(input.customerId) : null,
        billId: input.billId ? Number(input.billId) : null,
        runningOrderId: input.runningOrderId ? Number(input.runningOrderId) : null,
        errorCode: input.errorCode?.trim() || null,
        correlationId: input.correlationId?.trim() || null,
        environment: input.environment?.trim() || null,
      },
    });

    const ticket = await tx.supportTicket.update({
      where: { id: created.id },
      data: { ticketNo: ticketNoForId(created.id) },
    });

    await tx.supportTicketEvent.create({
      data: { ticketId: ticket.id, actorId: req.internal.id, type: "CREATED", toValue: "NEW" },
    });

    await tx.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.TICKET_CREATED,
        resourceType: "SupportTicket",
        resourceId: ticket.id,
        resourceLabel: ticket.ticketNo,
        newValue: { title: ticket.title, category: ticket.category, priority: ticket.priority },
      }),
    });

    return ticket;
  });
};

export const getTicket = async (ticketId: number) => {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
      comments: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, name: true, email: true } } },
      },
      events: {
        orderBy: { createdAt: "asc" },
        include: { actor: { select: { id: true, name: true } } },
      },
      attachments: true,
    },
  });
  if (!ticket) throw notFound("Ticket not found", "TICKET_NOT_FOUND");

  // Linked entity headlines, so the detail page can show context without the
  // employee opening four tabs. Full records still come from their own
  // endpoints, where their own permission checks apply.
  const [restaurant, customer, bill] = await Promise.all([
    ticket.restaurantId
      ? prisma.restaurant.findUnique({
          where: { id: ticket.restaurantId },
          select: { id: true, name: true, city: true, platformStatus: true },
        })
      : null,
    ticket.customerId
      ? prisma.customer.findUnique({ where: { id: ticket.customerId }, select: { id: true, name: true } })
      : null,
    ticket.billId
      ? prisma.bill.findUnique({
          where: { id: ticket.billId },
          select: { id: true, billNo: true, total: true, status: true, orderStatus: true },
        })
      : null,
  ]);

  // The ticket page reads the cached Jira status and queues a background
  // refresh; it does not call Jira inline.
  //
  // Polling on read meant every page load waited on a third party — up to the
  // client's 10-second timeout — so a slow Jira made support slow, and a Jira
  // outage made a ticket take ten seconds to open. It also meant the status was
  // only ever as fresh as the last time somebody happened to look, so the
  // Engineering Issues *list* showed whatever each ticket was showing when it
  // was last opened.
  //
  // Queuing is de-duplicated, so five people opening the same ticket produces
  // one sync rather than five.
  let jira = null as { key: string; url: string; status?: string | null } | null;
  if (ticket.jiraIssueKey) {
    jira = {
      key: ticket.jiraIssueKey,
      url: ticket.jiraIssueUrl ?? buildJiraUrl(ticket.jiraIssueKey) ?? "",
      status: ticket.jiraStatus,
    };
    // Fire-and-forget: failing to queue a refresh must not fail the read.
    void queueJiraSync(ticket.id).catch(() => undefined);
  }

  return {
    ...ticket,
    linked: { restaurant, customer, order: bill },
    jira,
    jiraSyncedAt: ticket.jiraSyncedAt,
    jiraConfigured: isJiraConfigured(),
    allowedTransitions: ALLOWED_TRANSITIONS[ticket.status as TicketStatus] ?? [],
  };
};

export const updateTicketStatus = async (req: any, ticketId: number, status: string, note?: string) => {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw notFound("Ticket not found", "TICKET_NOT_FOUND");

  if (!(TICKET_STATUSES as readonly string[]).includes(status)) {
    throw invalidState("That isn't a valid ticket status.", "INVALID_STATUS");
  }
  assertTicketTransition(ticket.status as TicketStatus, status as TicketStatus);

  const now = new Date();
  const [updated] = await prisma.$transaction([
    prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: status as any,
        resolvedAt: status === "RESOLVED" ? now : ticket.resolvedAt,
        closedAt: status === "CLOSED" ? now : ticket.closedAt,
      },
    }),
    prisma.supportTicketEvent.create({
      data: {
        ticketId,
        actorId: req.internal.id,
        type: "STATUS_CHANGED",
        fromValue: ticket.status,
        toValue: status,
        message: note ?? null,
      },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action:
          status === "RESOLVED"
            ? AUDIT_ACTIONS.TICKET_RESOLVED
            : status === "CLOSED"
              ? AUDIT_ACTIONS.TICKET_CLOSED
              : AUDIT_ACTIONS.TICKET_UPDATED,
        resourceType: "SupportTicket",
        resourceId: ticketId,
        resourceLabel: ticket.ticketNo,
        previousValue: { status: ticket.status },
        newValue: { status },
        reason: note ?? null,
      }),
    }),
  ]);

  return updated;
};

export const assignTicket = async (req: any, ticketId: number, assigneeId: number | null) => {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw notFound("Ticket not found", "TICKET_NOT_FOUND");

  if (assigneeId) {
    const assignee = await prisma.internalUser.findUnique({ where: { id: assigneeId } });
    if (!assignee) throw notFound("That employee doesn't exist.", "EMPLOYEE_NOT_FOUND");
    if (assignee.status !== "ACTIVE") {
      throw invalidState(`${assignee.name}'s account isn't active, so they can't be assigned work.`, "EMPLOYEE_INACTIVE");
    }
  }

  const [updated] = await prisma.$transaction([
    prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        assignedToId: assigneeId,
        // Picking up a brand-new ticket implicitly triages it; leaving it NEW
        // would keep it in the unassigned-work queue it has just left.
        status: ticket.status === "NEW" && assigneeId ? "TRIAGED" : ticket.status,
      },
    }),
    prisma.supportTicketEvent.create({
      data: {
        ticketId,
        actorId: req.internal.id,
        type: "ASSIGNED",
        fromValue: ticket.assignedToId ? String(ticket.assignedToId) : null,
        toValue: assigneeId ? String(assigneeId) : null,
      },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.TICKET_ASSIGNED,
        resourceType: "SupportTicket",
        resourceId: ticketId,
        resourceLabel: ticket.ticketNo,
        previousValue: { assignedToId: ticket.assignedToId },
        newValue: { assignedToId: assigneeId },
      }),
    }),
  ]);

  return updated;
};

export const addComment = async (req: any, ticketId: number, body: string) => {
  if (!body?.trim()) throw invalidState("Write something before posting.", "COMMENT_EMPTY");
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw notFound("Ticket not found", "TICKET_NOT_FOUND");
  if (ticket.status === "CLOSED") {
    throw invalidState("This ticket is closed. Raise a new one if the problem is back.", "TICKET_CLOSED");
  }

  return prisma.supportTicketComment.create({
    data: { ticketId, authorId: req.internal.id, body: body.trim() },
    include: { author: { select: { id: true, name: true, email: true } } },
  });
};

/**
 * Escalation to engineering.
 *
 * The internal ticket is marked escalated *first*, in its own transaction, and
 * the Jira issue is created after. That ordering is deliberate: if Jira is down
 * or misconfigured, the operational record still reflects that support handed
 * this over, and the Jira issue can be linked when the integration is back. The
 * alternative — rolling the escalation back on a Jira failure — makes Dine
 * Inc.'s own workflow depend on a third party being up.
 */
export const escalateTicket = async (
  req: any,
  ticketId: number,
  input: { errorCode?: string; correlationId?: string; environment?: string; note?: string },
) => {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw notFound("Ticket not found", "TICKET_NOT_FOUND");
  if (ticket.jiraIssueKey) {
    throw invalidState(
      `This ticket is already linked to ${ticket.jiraIssueKey}.`,
      "ALREADY_ESCALATED",
    );
  }
  if (ticket.status === "CLOSED" || ticket.status === "RESOLVED") {
    throw invalidState("A resolved or closed ticket can't be escalated. Reopen it first.", "TICKET_NOT_OPEN");
  }

  const escalatedAt = new Date();
  await prisma.$transaction([
    prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: "ESCALATED_TO_ENGINEERING",
        escalatedAt,
        errorCode: input.errorCode?.trim() || ticket.errorCode,
        correlationId: input.correlationId?.trim() || ticket.correlationId,
        environment: input.environment?.trim() || ticket.environment,
      },
    }),
    prisma.supportTicketEvent.create({
      data: {
        ticketId,
        actorId: req.internal.id,
        type: "ESCALATED",
        fromValue: ticket.status,
        toValue: "ESCALATED_TO_ENGINEERING",
        message: input.note ?? null,
      },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.TICKET_ESCALATED,
        resourceType: "SupportTicket",
        resourceId: ticketId,
        resourceLabel: ticket.ticketNo,
        previousValue: { status: ticket.status },
        newValue: { status: "ESCALATED_TO_ENGINEERING" },
        reason: input.note ?? null,
        correlationId: input.correlationId ?? ticket.correlationId,
      }),
    }),
  ]);

  let jira = null;
  let jiraError: { code: string; message: string } | null = null;

  try {
    jira = await createJiraIssue({
      ticketNo: ticket.ticketNo,
      title: ticket.title,
      description: ticket.description,
      priority: ticket.priority,
      restaurantId: ticket.restaurantId,
      orderId: ticket.billId,
      transactionId: ticket.billId,
      errorCode: input.errorCode ?? ticket.errorCode,
      correlationId: input.correlationId ?? ticket.correlationId,
      environment: input.environment ?? ticket.environment,
      reportedBy: req.internal.email,
    });

    await prisma.$transaction([
      prisma.supportTicket.update({
        where: { id: ticketId },
        data: { jiraIssueKey: jira.key, jiraIssueUrl: jira.url, jiraSyncedAt: new Date() },
      }),
      prisma.supportTicketEvent.create({
        data: { ticketId, actorId: req.internal.id, type: "JIRA_LINKED", toValue: jira.key },
      }),
      prisma.internalAuditLog.create({
        data: auditData(req, {
          action: AUDIT_ACTIONS.JIRA_ISSUE_CREATED,
          resourceType: "SupportTicket",
          resourceId: ticketId,
          resourceLabel: ticket.ticketNo,
          newValue: { jiraIssueKey: jira.key },
        }),
      }),
    ]);
  } catch (error) {
    if (error instanceof ApiError) {
      jiraError = { code: error.code, message: error.message };
    } else {
      console.error("[tickets] unexpected Jira failure", error);
      jiraError = { code: "JIRA_UNKNOWN_ERROR", message: "The ticket is escalated, but Jira couldn't be reached." };
    }
  }

  return { escalated: true, jira, jiraError };
};

/** Links an already-existing Jira issue, for when escalation couldn't reach it. */
export const linkJiraIssue = async (req: any, ticketId: number, issueKey: string) => {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw notFound("Ticket not found", "TICKET_NOT_FOUND");
  if (!issueKey?.trim()) throw invalidState("Enter the Jira issue key.", "JIRA_KEY_REQUIRED");

  const key = issueKey.trim().toUpperCase();
  const live = await fetchJiraIssue(key);

  const [updated] = await prisma.$transaction([
    prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        jiraIssueKey: key,
        jiraIssueUrl: live?.url ?? buildJiraUrl(key),
        jiraStatus: live?.status ?? null,
        jiraSyncedAt: live ? new Date() : null,
        status: ticket.status === "ESCALATED_TO_ENGINEERING" ? ticket.status : ("ESCALATED_TO_ENGINEERING" as any),
        escalatedAt: ticket.escalatedAt ?? new Date(),
      },
    }),
    prisma.supportTicketEvent.create({
      data: { ticketId, actorId: req.internal.id, type: "JIRA_LINKED", toValue: key },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.JIRA_ISSUE_LINKED,
        resourceType: "SupportTicket",
        resourceId: ticketId,
        resourceLabel: ticket.ticketNo,
        newValue: { jiraIssueKey: key },
      }),
    }),
  ]);

  return { ...updated, jiraFound: Boolean(live) };
};

/** Engineering's view: escalated tickets and the state of their Jira issues. */
export const listEngineeringIssues = async (req: any, query: any) => {
  const page = parsePage(query);
  const where = {
    AND: [
      relatedAccountWhere(req),
      {
        OR: [
          { status: { in: ["ESCALATED_TO_ENGINEERING", "ENGINEERING_RESOLVED"] as any } },
          { jiraIssueKey: { not: null } },
        ],
      },
    ],
  };

  const [rows, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      orderBy: [{ priority: "desc" }, { escalatedAt: "desc" }],
      skip: page.skip,
      take: page.take,
      select: {
        id: true,
        ticketNo: true,
        title: true,
        priority: true,
        status: true,
        category: true,
        errorCode: true,
        correlationId: true,
        environment: true,
        restaurantId: true,
        billId: true,
        jiraIssueKey: true,
        jiraStatus: true,
        jiraSyncedAt: true,
        escalatedAt: true,
        createdAt: true,
        assignedTo: { select: { id: true, name: true } },
      },
    }),
    prisma.supportTicket.count({ where }),
  ]);

  return toPaged(
    rows.map((row) => ({ ...row, jiraUrl: row.jiraIssueKey ? buildJiraUrl(row.jiraIssueKey) : null })),
    total,
    page,
  );
};
