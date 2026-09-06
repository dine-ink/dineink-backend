import prisma from "../../../config/prisma";
import { accountWhere, relatedAccountWhere } from "../rbac/scope";
import { invalidState } from "../shared/apiError";
import { applyContactMasking } from "../shared/pii";
import { PERMISSIONS } from "../rbac/permissions";

/**
 * Reports.
 *
 * Viewing a report on screen and walking out with the whole customer base as a
 * spreadsheet are different risks, so REPORT_VIEW and REPORT_EXPORT are
 * separate grants and every export is audited by the route.
 *
 * The customer report additionally respects CUSTOMER_PII_VIEW: without it the
 * contact columns are masked in the file itself, not just on screen. An export
 * that quietly contained what the UI was hiding would defeat the whole masking
 * arrangement.
 */

export interface ReportDefinition {
  key: string;
  name: string;
  description: string;
  permissions: string[];
  /** Row counts can be large; the UI warns before generating these. */
  large?: boolean;
}

export const REPORTS: ReportDefinition[] = [
  {
    key: "accounts",
    name: "Customers",
    description: "Every customer account with lifecycle status, owner, products, plans and onboarding state.",
    permissions: [PERMISSIONS.ACCOUNT_VIEW],
  },
  {
    key: "subscriptions",
    name: "Subscriptions",
    description: "Every subscription with product, plan, status and key dates. Plan pricing needs the revenue permission.",
    permissions: [PERMISSIONS.SUBSCRIPTION_VIEW],
  },
  {
    key: "invoices",
    name: "Invoices",
    description: "Invoices raised to customers over a date range, with amounts paid and outstanding.",
    permissions: [PERMISSIONS.INVOICE_VIEW, PERMISSIONS.ANALYTICS_FINANCIAL_VIEW],
  },
  {
    key: "product-adoption",
    name: "Product adoption",
    description: "How many subscriptions sit on each product and plan, by status.",
    permissions: [PERMISSIONS.SUBSCRIPTION_VIEW, PERMISSIONS.ANALYTICS_VIEW],
  },
  {
    key: "support-tickets",
    name: "Support tickets",
    description: "Tickets with category, priority, status, assignee and Jira link.",
    permissions: [PERMISSIONS.TICKET_VIEW],
  },
  {
    key: "audit",
    name: "Audit trail",
    description: "Actions taken in this console over a date range.",
    permissions: [PERMISSIONS.AUDIT_VIEW],
  },
  {
    key: "customers",
    name: "Diners",
    description: "Diner records held by customers' restaurants. Contact details are masked without the PII permission.",
    permissions: [PERMISSIONS.CUSTOMER_VIEW],
    large: true,
  },
];

const resolveRange = (query: any) => {
  const to = query?.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date();
  const from = query?.from ? new Date(query.from) : new Date(to.getTime() - 29 * 86_400_000);
  return { from, to };
};

export interface ReportResult {
  columns: string[];
  rows: (string | number | null)[][];
  rowCount: number;
  truncated: boolean;
}

// Reports are bounded. An unbounded export of the Bill table would be millions
// of rows and would take the database down on the way out.
const ROW_LIMIT = 5000;

export const buildReport = async (
  req: any,
  key: string,
  query: any,
  permissions: Set<string>,
): Promise<ReportResult> => {
  const definition = REPORTS.find((r) => r.key === key);
  if (!definition) throw invalidState(`There is no report called "${key}".`, "UNKNOWN_REPORT");

  const missing = definition.permissions.filter((p) => !permissions.has(p));
  if (missing.length) {
    throw invalidState("You do not have permission to run that report.", "PERMISSION_DENIED");
  }

  const { from, to } = resolveRange(query);

  switch (key) {
    case "accounts": {
      const rows = await prisma.account.findMany({
        where: accountWhere(req),
        orderBy: { createdAt: "asc" },
        take: ROW_LIMIT,
        select: {
          id: true,
          accountCode: true,
          name: true,
          city: true,
          state: true,
          status: true,
          createdAt: true,
          becameCustomerAt: true,
          churnedAt: true,
          owner: { select: { name: true } },
          subscriptions: {
            where: { status: { in: ["ACTIVE", "TRIAL", "PAST_DUE"] } },
            select: { product: { select: { name: true } }, plan: { select: { name: true } }, status: true },
          },
          onboardings: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
          _count: { select: { restaurants: true, contacts: true } },
        },
      });
      return {
        columns: [
          "Account", "Name", "City", "State", "Status", "Owner",
          "Products", "Plans", "Subscription status", "Onboarding",
          "Systems", "Contacts", "Created", "Customer since", "Churned",
        ],
        rows: rows.map((r) => [
          r.accountCode,
          r.name,
          r.city,
          r.state,
          r.status,
          r.owner?.name ?? null,
          // A customer can hold more than one subscription, so these columns
          // list rather than assume one.
          r.subscriptions.map((s) => s.product.name).join("; ") || null,
          r.subscriptions.map((s) => s.plan?.name ?? "—").join("; ") || null,
          r.subscriptions.map((s) => s.status).join("; ") || null,
          r.onboardings[0]?.status ?? null,
          r._count.restaurants,
          r._count.contacts,
          r.createdAt.toISOString().slice(0, 10),
          r.becameCustomerAt ? r.becameCustomerAt.toISOString().slice(0, 10) : null,
          r.churnedAt ? r.churnedAt.toISOString().slice(0, 10) : null,
        ]),
        rowCount: rows.length,
        truncated: rows.length === ROW_LIMIT,
      };
    }

    case "subscriptions": {
      const rows = await prisma.subscription.findMany({
        where: relatedAccountWhere(req),
        orderBy: { startDate: "desc" },
        take: ROW_LIMIT,
        include: {
          account: { select: { accountCode: true, name: true } },
          product: { select: { name: true } },
          plan: { select: { name: true, priceAmount: true, currency: true } },
        },
      });
      const canSeeMoney = permissions.has(PERMISSIONS.ANALYTICS_FINANCIAL_VIEW);
      return {
        columns: [
          "Subscription", "Account", "Name", "Product", "Plan", "Status",
          "Billing interval", ...(canSeeMoney ? ["Plan price", "Currency"] : []),
          "Start", "Trial ends", "Renewal", "Cancelled",
        ],
        rows: rows.map((s) => [
          s.subscriptionCode,
          s.account.accountCode,
          s.account.name,
          s.product.name,
          s.plan?.name ?? null,
          s.status,
          s.billingInterval,
          // Null price stays null in the export, never zero: the file has to
          // carry the same "not configured" meaning the screen does.
          ...(canSeeMoney
            ? [
                s.plan?.priceAmount === null || s.plan?.priceAmount === undefined
                  ? null
                  : Number(s.plan.priceAmount),
                s.plan?.currency ?? null,
              ]
            : []),
          s.startDate.toISOString().slice(0, 10),
          s.trialEndsAt ? s.trialEndsAt.toISOString().slice(0, 10) : null,
          s.renewalDate ? s.renewalDate.toISOString().slice(0, 10) : null,
          s.cancelledAt ? s.cancelledAt.toISOString().slice(0, 10) : null,
        ]),
        rowCount: rows.length,
        truncated: rows.length === ROW_LIMIT,
      };
    }

    case "invoices": {
      const rows = await prisma.invoice.findMany({
        where: {
          AND: [
            relatedAccountWhere(req),
            { issueDate: { gte: from, lte: to } },
          ],
        },
        orderBy: { issueDate: "desc" },
        take: ROW_LIMIT,
        include: {
          account: { select: { accountCode: true, name: true, gstNumber: true } },
          subscription: { select: { subscriptionCode: true } },
        },
      });
      return {
        columns: [
          "Invoice", "Account", "Name", "GST", "Subscription", "Status",
          "Issued", "Due", "Subtotal", "Tax", "Total", "Paid", "Outstanding", "Currency",
        ],
        rows: rows.map((i) => [
          i.invoiceNo,
          i.account.accountCode,
          i.account.name,
          i.account.gstNumber,
          i.subscription?.subscriptionCode ?? null,
          i.status,
          i.issueDate ? i.issueDate.toISOString().slice(0, 10) : null,
          i.dueDate ? i.dueDate.toISOString().slice(0, 10) : null,
          Number(i.subtotal),
          i.taxAmount === null ? null : Number(i.taxAmount),
          Number(i.total),
          Number(i.amountPaid),
          Math.max(0, Number(i.total) - Number(i.amountPaid)),
          i.currency,
        ]),
        rowCount: rows.length,
        truncated: rows.length === ROW_LIMIT,
      };
    }

    case "product-adoption": {
      const rows = await prisma.subscription.groupBy({
        by: ["productId", "planId", "status"],
        where: relatedAccountWhere(req),
        _count: { _all: true },
      });
      const [products, plans] = await Promise.all([
        prisma.product.findMany({ select: { id: true, name: true } }),
        prisma.plan.findMany({ select: { id: true, name: true } }),
      ]);
      const productById = new Map(products.map((p) => [p.id, p.name]));
      const planById = new Map(plans.map((p) => [p.id, p.name]));
      return {
        columns: ["Product", "Plan", "Subscription status", "Subscriptions"],
        rows: rows
          .sort((a, b) => b._count._all - a._count._all)
          .map((r) => [
            productById.get(r.productId) ?? `#${r.productId}`,
            r.planId ? (planById.get(r.planId) ?? `#${r.planId}`) : null,
            r.status,
            r._count._all,
          ]),
        rowCount: rows.length,
        truncated: false,
      };
    }

    case "support-tickets": {
      const rows = await prisma.supportTicket.findMany({
        where: { createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: "desc" },
        take: ROW_LIMIT,
        include: {
          createdBy: { select: { name: true } },
          assignedTo: { select: { name: true } },
        },
      });
      return {
        columns: [
          "Ticket", "Title", "Category", "Priority", "Status",
          "Account", "Raised by", "Assigned to", "Jira", "Raised", "Resolved",
        ],
        rows: rows.map((t) => [
          t.ticketNo,
          t.title,
          t.category,
          t.priority,
          t.status,
          t.restaurantId ? `RES-${t.restaurantId}` : null,
          t.createdBy ? t.createdBy.name : null,
          t.assignedTo ? t.assignedTo.name : null,
          t.jiraIssueKey,
          t.createdAt.toISOString().slice(0, 16).replace("T", " "),
          t.resolvedAt ? t.resolvedAt.toISOString().slice(0, 16).replace("T", " ") : null,
        ]),
        rowCount: rows.length,
        truncated: rows.length === ROW_LIMIT,
      };
    }

    case "audit": {
      const rows = await prisma.internalAuditLog.findMany({
        where: { createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: "desc" },
        take: ROW_LIMIT,
      });
      return {
        columns: ["When", "Who", "Action", "Resource", "Resource ID", "Reason", "IP"],
        rows: rows.map((a) => [
          a.createdAt.toISOString().slice(0, 19).replace("T", " "),
          a.actorName ?? a.actorEmail ?? "System",
          a.action,
          a.resourceType,
          a.resourceId,
          a.reason,
          a.ip,
        ]),
        rowCount: rows.length,
        truncated: rows.length === ROW_LIMIT,
      };
    }

    case "customers": {
      const canViewPii = permissions.has(PERMISSIONS.CUSTOMER_PII_VIEW);
      const rows = await prisma.customer.findMany({
        orderBy: { createdAt: "desc" },
        take: ROW_LIMIT,
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          createdAt: true,
          restaurant: { select: { id: true, name: true } },
        },
      });
      return {
        columns: ["Customer ID", "Name", "Phone", "Email", "Account", "Registered", "Contact details"],
        rows: rows.map((c) => {
          const masked = applyContactMasking(c, canViewPii);
          return [
            `CUST-${c.id}`,
            masked.name,
            masked.phone,
            masked.email,
            c.restaurant ? `RES-${c.restaurant.id} ${c.restaurant.name}` : null,
            c.createdAt.toISOString().slice(0, 10),
            canViewPii ? "full" : "masked",
          ];
        }),
        rowCount: rows.length,
        truncated: rows.length === ROW_LIMIT,
      };
    }

    default:
      throw invalidState(`There is no report called "${key}".`, "UNKNOWN_REPORT");
  }
};

/**
 * RFC 4180 quoting. A restaurant whose name contains a comma must not shift
 * every column after it, and one containing a quote must not break the file.
 */
export const toCsv = (result: ReportResult): string => {
  const escape = (value: string | number | null) => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    result.columns.map(escape).join(","),
    ...result.rows.map((row) => row.map(escape).join(",")),
  ].join("\r\n");
};

/** Which reports this employee can actually run, for the list screen. */
export const availableReports = (permissions: Set<string>) =>
  REPORTS.map((report) => ({
    ...report,
    available: report.permissions.every((p) => permissions.has(p)),
  }));
