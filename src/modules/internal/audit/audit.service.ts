import prisma from "../../../config/prisma";
import { clientIp } from "../rbac/internalAuth.middleware";

/**
 * The audit trail for the internal application.
 *
 * Two ways to write a record, and the difference matters:
 *
 *  - `auditData(...)` builds the row so it can be created inside the same
 *    `prisma.$transaction` as the change itself. Use this for anything that
 *    mutates state — if the audit write fails the business change must roll
 *    back with it, otherwise the platform quietly performs privileged actions
 *    it has no record of.
 *
 *  - `recordAudit(...)` writes on its own and swallows failures. Use it only
 *    for observational records (a PII field was revealed, a report was
 *    exported) where there is no transaction to join and failing the user's
 *    read would be worse than losing one log line.
 *
 * Nothing in the internal API updates or deletes an InternalAuditLog row —
 * there is no route for it. The table is append-only from the application's
 * point of view.
 */

export const AUDIT_ACTIONS = {
  // Auth
  LOGIN_SUCCESS: "LOGIN_SUCCESS",
  LOGIN_FAILED: "LOGIN_FAILED",
  LOGOUT: "LOGOUT",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  PASSWORD_RESET_REQUESTED: "PASSWORD_RESET_REQUESTED",
  PASSWORD_RESET_COMPLETED: "PASSWORD_RESET_COMPLETED",
  SESSION_REVOKED: "SESSION_REVOKED",

  // Accounts (the commercial customer)
  ACCOUNT_CREATED: "ACCOUNT_CREATED",
  ACCOUNT_UPDATED: "ACCOUNT_UPDATED",
  ACCOUNT_LIFECYCLE_CHANGED: "ACCOUNT_LIFECYCLE_CHANGED",
  ACCOUNT_CONVERTED: "ACCOUNT_CONVERTED",
  ACCOUNT_CHURNED: "ACCOUNT_CHURNED",
  ACCOUNT_CONTACT_CREATED: "ACCOUNT_CONTACT_CREATED",
  ACCOUNT_CONTACT_UPDATED: "ACCOUNT_CONTACT_UPDATED",
  ACCOUNT_CONTACT_DELETED: "ACCOUNT_CONTACT_DELETED",
  // Assigning an employee to an account grants them that customer's data, so
  // it is recorded as the access grant it is.
  ACCOUNT_ASSIGNMENT_GRANTED: "ACCOUNT_ASSIGNMENT_GRANTED",
  ACCOUNT_ASSIGNMENT_REVOKED: "ACCOUNT_ASSIGNMENT_REVOKED",
  LOCATION_STATUS_CHANGED: "LOCATION_STATUS_CHANGED",

  // Product catalogue
  PRODUCT_CREATED: "PRODUCT_CREATED",
  PRODUCT_UPDATED: "PRODUCT_UPDATED",
  PLAN_CREATED: "PLAN_CREATED",
  PLAN_UPDATED: "PLAN_UPDATED",
  PLAN_PRICING_CHANGED: "PLAN_PRICING_CHANGED",

  // Subscriptions
  SUBSCRIPTION_CREATED: "SUBSCRIPTION_CREATED",
  SUBSCRIPTION_UPDATED: "SUBSCRIPTION_UPDATED",
  SUBSCRIPTION_STATUS_CHANGED: "SUBSCRIPTION_STATUS_CHANGED",
  SUBSCRIPTION_PLAN_CHANGED: "SUBSCRIPTION_PLAN_CHANGED",
  SUBSCRIPTION_CANCELLED: "SUBSCRIPTION_CANCELLED",

  // Billing
  INVOICE_CREATED: "INVOICE_CREATED",
  INVOICE_UPDATED: "INVOICE_UPDATED",
  INVOICE_ISSUED: "INVOICE_ISSUED",
  INVOICE_VOIDED: "INVOICE_VOIDED",
  PAYMENT_RECORDED: "PAYMENT_RECORDED",
  PAYMENT_UPDATED: "PAYMENT_UPDATED",
  CREDIT_NOTE_ISSUED: "CREDIT_NOTE_ISSUED",

  // Onboarding
  ONBOARDING_STARTED: "ONBOARDING_STARTED",
  ONBOARDING_STATUS_CHANGED: "ONBOARDING_STATUS_CHANGED",
  ONBOARDING_ASSIGNED: "ONBOARDING_ASSIGNED",
  ONBOARDING_WENT_LIVE: "ONBOARDING_WENT_LIVE",

  // Sales
  OPPORTUNITY_CREATED: "OPPORTUNITY_CREATED",
  OPPORTUNITY_UPDATED: "OPPORTUNITY_UPDATED",
  OPPORTUNITY_STAGE_CHANGED: "OPPORTUNITY_STAGE_CHANGED",

  // Restaurants (the product tenant)
  RESTAURANT_CREATED: "RESTAURANT_CREATED",
  RESTAURANT_UPDATED: "RESTAURANT_UPDATED",
  RESTAURANT_ACTIVATED: "RESTAURANT_ACTIVATED",
  RESTAURANT_SUSPENDED: "RESTAURANT_SUSPENDED",
  RESTAURANT_REINSTATED: "RESTAURANT_REINSTATED",
  RESTAURANT_STAGE_CHANGED: "RESTAURANT_STAGE_CHANGED",
  ONBOARDING_TASK_UPDATED: "ONBOARDING_TASK_UPDATED",

  // Restaurant users / menu / tables
  RESTAURANT_USER_CREATED: "RESTAURANT_USER_CREATED",
  RESTAURANT_USER_UPDATED: "RESTAURANT_USER_UPDATED",
  RESTAURANT_USER_DISABLED: "RESTAURANT_USER_DISABLED",
  RESTAURANT_USER_ACCESS_RESET: "RESTAURANT_USER_ACCESS_RESET",
  MENU_ITEM_UPDATED: "MENU_ITEM_UPDATED",
  QR_GENERATED: "QR_GENERATED",
  QR_REGENERATED: "QR_REGENERATED",
  QR_ENABLED: "QR_ENABLED",
  QR_DISABLED: "QR_DISABLED",

  // Data access
  CUSTOMER_PII_VIEWED: "CUSTOMER_PII_VIEWED",
  REPORT_EXPORTED: "REPORT_EXPORTED",

  // Support
  TICKET_CREATED: "TICKET_CREATED",
  TICKET_ATTACHMENT_ADDED: "TICKET_ATTACHMENT_ADDED",
  // Downloading someone's evidence is a data-access event in its own right.
  TICKET_ATTACHMENT_DOWNLOADED: "TICKET_ATTACHMENT_DOWNLOADED",
  TICKET_ATTACHMENT_DELETED: "TICKET_ATTACHMENT_DELETED",
  TICKET_UPDATED: "TICKET_UPDATED",
  TICKET_ASSIGNED: "TICKET_ASSIGNED",
  TICKET_ESCALATED: "TICKET_ESCALATED",
  TICKET_RESOLVED: "TICKET_RESOLVED",
  TICKET_CLOSED: "TICKET_CLOSED",
  JIRA_ISSUE_CREATED: "JIRA_ISSUE_CREATED",
  JIRA_ISSUE_LINKED: "JIRA_ISSUE_LINKED",

  // Administration
  EMPLOYEE_CREATED: "EMPLOYEE_CREATED",
  EMPLOYEE_UPDATED: "EMPLOYEE_UPDATED",
  EMPLOYEE_DISABLED: "EMPLOYEE_DISABLED",
  EMPLOYEE_ENABLED: "EMPLOYEE_ENABLED",
  EMPLOYEE_ROLES_CHANGED: "EMPLOYEE_ROLES_CHANGED",
  ROLE_CREATED: "ROLE_CREATED",
  ROLE_UPDATED: "ROLE_UPDATED",
  ROLE_PERMISSIONS_CHANGED: "ROLE_PERMISSIONS_CHANGED",

  // Configuration
  SETTING_CHANGED: "SETTING_CHANGED",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditInput {
  action: AuditAction;
  resourceType: string;
  resourceId?: string | number | null;
  resourceLabel?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  correlationId?: string | null;
  /** Only for records written before a session exists — i.e. failed logins. */
  actorOverride?: { id?: number | null; email?: string | null; name?: string | null };
}

const toJson = (value: unknown) =>
  value === undefined || value === null ? undefined : (value as any);

export const auditData = (req: any, input: AuditInput) => {
  const actor = input.actorOverride ?? {
    id: req?.internal?.id ?? null,
    email: req?.internal?.email ?? null,
    name: req?.internal?.name ?? null,
  };
  return {
    actorId: actor.id ?? null,
    actorEmail: actor.email ?? null,
    actorName: actor.name ?? null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId === undefined || input.resourceId === null ? null : String(input.resourceId),
    resourceLabel: input.resourceLabel ?? null,
    previousValue: toJson(input.previousValue),
    newValue: toJson(input.newValue),
    reason: input.reason ?? null,
    ip: req ? clientIp(req) ?? null : null,
    userAgent: (req?.headers?.["user-agent"] as string | undefined) ?? null,
    correlationId: input.correlationId ?? null,
  };
};

/** Observational audit write. Never throws — see the note at the top. */
export const recordAudit = async (req: any, input: AuditInput) => {
  try {
    await prisma.internalAuditLog.create({ data: auditData(req, input) });
  } catch (error) {
    console.error("[audit] failed to write audit record", input.action, error);
  }
};

/**
 * Only a subset of fields is ever worth diffing into an audit record — dumping
 * a whole Prisma row would put things like password hashes into the log.
 */
export const pick = <T extends Record<string, any>>(source: T | null | undefined, keys: (keyof T)[]) => {
  if (!source) return null;
  const out: Record<string, any> = {};
  for (const key of keys) out[key as string] = source[key];
  return out;
};

export interface AuditQuery {
  page?: number;
  pageSize?: number;
  actorId?: number;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  search?: string;
  from?: string;
  to?: string;
}

export const listAuditLogs = async (query: AuditQuery) => {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));

  const where: any = {};
  if (query.actorId) where.actorId = Number(query.actorId);
  if (query.action) where.action = query.action;
  if (query.resourceType) where.resourceType = query.resourceType;
  if (query.resourceId) where.resourceId = String(query.resourceId);
  if (query.from || query.to) {
    where.createdAt = {};
    if (query.from) where.createdAt.gte = new Date(query.from);
    if (query.to) where.createdAt.lte = new Date(`${query.to}T23:59:59.999Z`);
  }
  if (query.search) {
    const term = query.search.trim();
    where.OR = [
      { actorEmail: { contains: term, mode: "insensitive" } },
      { actorName: { contains: term, mode: "insensitive" } },
      { action: { contains: term, mode: "insensitive" } },
      { resourceLabel: { contains: term, mode: "insensitive" } },
      { resourceId: { contains: term, mode: "insensitive" } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.internalAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.internalAuditLog.count({ where }),
  ]);

  return { rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

/** The audit trail for one entity, used by every detail page's Activity tab. */
export const listAuditForResource = async (resourceType: string, resourceId: string | number, limit = 50) =>
  prisma.internalAuditLog.findMany({
    where: { resourceType, resourceId: String(resourceId) },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
