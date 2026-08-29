import prisma from "../../../config/prisma";
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
    name: "Accounts",
    description: "Every restaurant account with status, outlets, orders and last activity.",
    permissions: [PERMISSIONS.RESTAURANT_VIEW],
  },
  {
    key: "account-usage",
    name: "Account usage",
    description: "Orders and value processed per account over a date range.",
    permissions: [PERMISSIONS.RESTAURANT_VIEW, PERMISSIONS.ANALYTICS_VIEW],
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
    name: "Customers",
    description: "Diner records held by restaurants. Contact details are masked without the PII permission.",
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
      const rows = await prisma.restaurant.findMany({
        orderBy: { createdAt: "asc" },
        take: ROW_LIMIT,
        select: {
          id: true,
          name: true,
          city: true,
          state: true,
          platformStatus: true,
          onboardingStage: true,
          createdAt: true,
          activatedAt: true,
          lastActivityAt: true,
          _count: { select: { branches: true, users: true, customers: true } },
        },
      });
      return {
        columns: [
          "Account ID", "Name", "City", "State", "Status", "Stage",
          "Outlets", "Staff", "Diners", "Created", "Live since", "Last activity",
        ],
        rows: rows.map((r) => [
          `RES-${r.id}`,
          r.name,
          r.city,
          r.state,
          r.platformStatus,
          r.onboardingStage,
          r._count.branches,
          r._count.users,
          r._count.customers,
          r.createdAt.toISOString().slice(0, 10),
          r.activatedAt ? r.activatedAt.toISOString().slice(0, 10) : null,
          r.lastActivityAt ? r.lastActivityAt.toISOString().slice(0, 10) : null,
        ]),
        rowCount: rows.length,
        truncated: rows.length === ROW_LIMIT,
      };
    }

    case "account-usage": {
      const grouped = await prisma.bill.groupBy({
        by: ["restaurantId"],
        where: { createdAt: { gte: from, lte: to }, status: { not: "CANCELLED" } },
        _count: { _all: true },
        _sum: { total: true },
        _max: { createdAt: true },
      });
      const names = await prisma.restaurant.findMany({
        where: { id: { in: grouped.map((g) => g.restaurantId) } },
        select: { id: true, name: true, platformStatus: true },
      });
      const byId = new Map(names.map((n) => [n.id, n]));
      const canSeeMoney = permissions.has(PERMISSIONS.ANALYTICS_FINANCIAL_VIEW);

      return {
        columns: [
          "Account ID", "Name", "Status", "Orders",
          ...(canSeeMoney ? ["Value processed"] : []),
          "Last order",
        ],
        rows: grouped
          .sort((a, b) => b._count._all - a._count._all)
          .map((g) => [
            `RES-${g.restaurantId}`,
            byId.get(g.restaurantId)?.name ?? null,
            byId.get(g.restaurantId)?.platformStatus ?? null,
            g._count._all,
            ...(canSeeMoney ? [g._sum.total ?? 0] : []),
            g._max.createdAt ? g._max.createdAt.toISOString().slice(0, 10) : null,
          ]),
        rowCount: grouped.length,
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
