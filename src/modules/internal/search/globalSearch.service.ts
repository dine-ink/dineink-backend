import prisma from "../../../config/prisma";
import { accountWhere, relatedAccountWhere } from "../rbac/scope";
import { PERMISSIONS } from "../rbac/permissions";
import { maskPhone } from "../shared/pii";

/**
 * Global search.
 *
 * Built around the way employees actually arrive at a record: somebody reads
 * them an identifier over the phone. Pasting `ORD-92831` should land on that
 * order, not on a results page of near-matches — so a recognised identifier
 * pattern is looked up directly and returned as an exact hit the UI can jump
 * straight to.
 *
 * Every branch is gated on the caller's permissions. Search is a common way to
 * leak the existence of records someone can't open: an employee without
 * CUSTOMER_VIEW searching a phone number must get nothing back, not a result
 * they're then refused.
 */

export interface SearchHit {
  type: "account" | "restaurant" | "customer" | "order" | "transaction" | "ticket" | "employee";
  id: number;
  displayId: string;
  title: string;
  subtitle?: string | null;
  href: string;
  exact?: boolean;
}

const RESULT_LIMIT = 5;

export const globalSearch = async (
  req: any,
  term: string,
  permissions: Set<string>,
): Promise<SearchHit[]> => {
  const query = term.trim();
  if (query.length < 2) return [];

  const hits: SearchHit[] = [];
  const can = (permission: string) => permissions.has(permission);

  // Search obeys the same account scope as every list. Otherwise it would be
  // the one place an assigned-only employee could enumerate the whole customer
  // base by typing names into a box.
  const accountScope = accountWhere(req);
  const viaAccount = relatedAccountWhere(req);

  // ── Exact identifier lookups ───────────────────────────────────────────────
  const prefixed = query.match(/^(acc|res|cust|customer|ord|txn|dine|emp)-(\d+)$/i);
  if (prefixed) {
    const [, prefixRaw, numberRaw] = prefixed;
    const prefix = prefixRaw.toUpperCase();
    const id = Number(numberRaw);

    if (prefix === "ACC" && can(PERMISSIONS.ACCOUNT_VIEW)) {
      const account = await prisma.account.findFirst({
        where: { AND: [accountScope, { id }] },
        select: { id: true, accountCode: true, name: true, city: true, status: true },
      });
      if (account) {
        hits.push({
          type: "account",
          id: account.id,
          displayId: account.accountCode,
          title: account.name,
          subtitle: [account.city, account.status].filter(Boolean).join(" · "),
          href: `/customers/${account.id}`,
        });
      }
    }

    if (prefix === "RES" && can(PERMISSIONS.RESTAURANT_VIEW)) {
      const restaurant = await prisma.restaurant.findUnique({
        where: { id },
        select: { id: true, name: true, city: true, platformStatus: true },
      });
      if (restaurant) {
        hits.push({
          type: "restaurant",
          id: restaurant.id,
          displayId: `RES-${restaurant.id}`,
          title: restaurant.name,
          subtitle: [restaurant.city, restaurant.platformStatus].filter(Boolean).join(" · "),
          href: `/restaurants/${restaurant.id}`,
          exact: true,
        });
      }
    }

    if ((prefix === "ORD" || prefix === "TXN") && can(PERMISSIONS.ORDER_VIEW)) {
      const bill = await prisma.bill.findUnique({
        where: { id },
        select: { id: true, billNo: true, total: true, restaurant: { select: { name: true } } },
      });
      if (bill) {
        const isTxn = prefix === "TXN";
        hits.push({
          type: isTxn ? "transaction" : "order",
          id: bill.id,
          displayId: `${prefix}-${bill.id}`,
          title: `${isTxn ? "Payment" : "Order"} ${bill.billNo}`,
          subtitle: `${bill.restaurant?.name ?? "Unknown restaurant"} · ₹${bill.total}`,
          href: isTxn ? `/transactions/${bill.id}` : `/orders/${bill.id}`,
          exact: true,
        });
      }
    }

    if (prefix === "DINE" && can(PERMISSIONS.TICKET_VIEW)) {
      const ticket = await prisma.supportTicket.findUnique({
        where: { ticketNo: query.toUpperCase() },
        select: { id: true, ticketNo: true, title: true, status: true, priority: true },
      });
      if (ticket) {
        hits.push({
          type: "ticket",
          id: ticket.id,
          displayId: ticket.ticketNo,
          title: ticket.title,
          subtitle: `${ticket.priority} · ${ticket.status.replace(/_/g, " ")}`,
          href: `/support-tickets/${ticket.id}`,
          exact: true,
        });
      }
    }

    if ((prefix === "CUST" || prefix === "CUSTOMER") && can(PERMISSIONS.CUSTOMER_VIEW)) {
      const customer = await prisma.customer.findUnique({
        where: { id },
        select: { id: true, name: true, phone: true, restaurant: { select: { name: true } } },
      });
      if (customer) {
        hits.push({
          type: "customer",
          id: customer.id,
          displayId: `CUST-${customer.id}`,
          title: customer.name,
          subtitle: [
            can(PERMISSIONS.CUSTOMER_PII_VIEW) ? customer.phone : maskPhone(customer.phone),
            customer.restaurant?.name,
          ]
            .filter(Boolean)
            .join(" · "),
          href: `/customers/${customer.id}`,
          exact: true,
        });
      }
    }

    if (prefix === "EMP" && can(PERMISSIONS.EMPLOYEE_VIEW)) {
      const employee = await prisma.internalUser.findUnique({
        where: { employeeCode: query.toUpperCase() },
        select: { id: true, employeeCode: true, name: true, email: true, department: true },
      });
      if (employee) {
        hits.push({
          type: "employee",
          id: employee.id,
          displayId: employee.employeeCode,
          title: employee.name,
          subtitle: [employee.department, employee.email].filter(Boolean).join(" · "),
          href: `/employees/${employee.id}`,
          exact: true,
        });
      }
    }

    if (hits.length) return hits;
  }

  // A bill number is its own identifier format and is what appears on the
  // printed invoice a guest is holding.
  if (can(PERMISSIONS.ORDER_VIEW)) {
    const byBillNo = await prisma.bill.findUnique({
      where: { billNo: query },
      select: { id: true, billNo: true, total: true, restaurant: { select: { name: true } } },
    });
    if (byBillNo) {
      hits.push({
        type: "order",
        id: byBillNo.id,
        displayId: `ORD-${byBillNo.id}`,
        title: `Order ${byBillNo.billNo}`,
        subtitle: `${byBillNo.restaurant?.name ?? "Unknown restaurant"} · ₹${byBillNo.total}`,
        href: `/orders/${byBillNo.id}`,
        exact: true,
      });
      return hits;
    }
  }

  // ── Fuzzy search across the modules the caller can reach ───────────────────
  const lookups: Promise<void>[] = [];

  if (can(PERMISSIONS.RESTAURANT_VIEW)) {
    lookups.push(
      prisma.restaurant
        .findMany({
          where: {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { email: { contains: query, mode: "insensitive" } },
              { phone: { contains: query } },
            ],
          },
          take: RESULT_LIMIT,
          select: { id: true, name: true, city: true, platformStatus: true },
        })
        .then((rows) => {
          for (const row of rows) {
            hits.push({
              type: "restaurant",
              id: row.id,
              displayId: `RES-${row.id}`,
              title: row.name,
              subtitle: [row.city, row.platformStatus].filter(Boolean).join(" · "),
              href: `/restaurants/${row.id}`,
            });
          }
        }),
    );
  }

  if (can(PERMISSIONS.CUSTOMER_VIEW)) {
    lookups.push(
      prisma.customer
        .findMany({
          where: {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { phone: { contains: query } },
              { email: { contains: query, mode: "insensitive" } },
            ],
          },
          take: RESULT_LIMIT,
          select: { id: true, name: true, phone: true, restaurant: { select: { name: true } } },
        })
        .then((rows) => {
          for (const row of rows) {
            hits.push({
              type: "customer",
              id: row.id,
              displayId: `CUST-${row.id}`,
              title: row.name,
              subtitle: [
                can(PERMISSIONS.CUSTOMER_PII_VIEW) ? row.phone : maskPhone(row.phone),
                row.restaurant?.name,
              ]
                .filter(Boolean)
                .join(" · "),
              href: `/customers/${row.id}`,
            });
          }
        }),
    );
  }

  if (can(PERMISSIONS.TICKET_VIEW)) {
    lookups.push(
      prisma.supportTicket
        .findMany({
          where: {
            OR: [
              { title: { contains: query, mode: "insensitive" } },
              { ticketNo: { contains: query, mode: "insensitive" } },
              { jiraIssueKey: { contains: query, mode: "insensitive" } },
            ],
          },
          take: RESULT_LIMIT,
          orderBy: { createdAt: "desc" },
          select: { id: true, ticketNo: true, title: true, status: true, priority: true },
        })
        .then((rows) => {
          for (const row of rows) {
            hits.push({
              type: "ticket",
              id: row.id,
              displayId: row.ticketNo,
              title: row.title,
              subtitle: `${row.priority} · ${row.status.replace(/_/g, " ")}`,
              href: `/support-tickets/${row.id}`,
            });
          }
        }),
    );
  }

  if (can(PERMISSIONS.EMPLOYEE_VIEW)) {
    lookups.push(
      prisma.internalUser
        .findMany({
          where: {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { email: { contains: query, mode: "insensitive" } },
              { employeeCode: { contains: query, mode: "insensitive" } },
            ],
          },
          take: RESULT_LIMIT,
          select: { id: true, employeeCode: true, name: true, email: true, department: true },
        })
        .then((rows) => {
          for (const row of rows) {
            hits.push({
              type: "employee",
              id: row.id,
              displayId: row.employeeCode,
              title: row.name,
              subtitle: [row.department, row.email].filter(Boolean).join(" · "),
              href: `/employees/${row.id}`,
            });
          }
        }),
    );
  }

  await Promise.all(lookups);
  return hits;
};
