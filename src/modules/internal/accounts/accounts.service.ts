import prisma from "../../../config/prisma";
import { AUDIT_ACTIONS, auditData } from "../audit/audit.service";
import { conflict, invalidState, notFound } from "../shared/apiError";
import { parsePage, parseSort, toPaged } from "../shared/pagination";
import { nextAccountCode } from "../shared/ids";
import { accountWhere, assertAccountAccess } from "../rbac/scope";
import { PERMISSIONS } from "../rbac/permissions";

/**
 * Accounts — the customers who buy DineInk.
 *
 * This is the entity the whole console was missing. `Restaurant` had been
 * standing in for it, which made a four-outlet group look like four customers
 * and left "what did they buy" and "are they paying" unanswerable.
 *
 * An Account owns Restaurants (product tenants), which own Branches (outlets).
 * Subscriptions, invoices, onboarding and tickets all hang off the Account,
 * because those are things a *customer* has, not things an outlet has.
 *
 * Every read here is scoped: `accountWhere(req)` in lists, `assertAccountAccess`
 * on by-id routes.
 */

const LIST_SORT_FIELDS = ["name", "createdAt", "becameCustomerAt", "status"] as const;

export interface AccountListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  productId?: number;
  planId?: number;
  subscriptionStatus?: string;
  onboardingStatus?: string;
  ownerId?: number | "none";
  city?: string;
  sortBy?: string;
  sortDir?: string;
}

export const listAccounts = async (req: any, query: AccountListQuery) => {
  const page = parsePage(query);
  const sort = parseSort(query, LIST_SORT_FIELDS, "createdAt");

  const term = query.search?.trim();
  const filters: any[] = [accountWhere(req)];

  if (term) {
    // ACC-12 is how employees refer to an account out loud, so the search box
    // has to understand it as well as it understands a name.
    const codeMatch = /^ACC-?(\d+)$/i.exec(term);
    filters.push({
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { legalName: { contains: term, mode: "insensitive" } },
        { accountCode: { contains: term, mode: "insensitive" } },
        { billingEmail: { contains: term, mode: "insensitive" } },
        { gstNumber: { contains: term, mode: "insensitive" } },
        ...(codeMatch ? [{ id: Number(codeMatch[1]) }] : []),
        { contacts: { some: { name: { contains: term, mode: "insensitive" } } } },
        { contacts: { some: { email: { contains: term, mode: "insensitive" } } } },
      ],
    });
  }

  if (query.status) filters.push({ status: { in: String(query.status).split(",") as any } });
  if (query.city) filters.push({ city: { equals: query.city, mode: "insensitive" } });
  if (query.ownerId === "none") filters.push({ ownerId: null });
  else if (query.ownerId) filters.push({ ownerId: Number(query.ownerId) });

  // Product, plan and subscription status are properties of what the account
  // bought, so they filter through the subscription relation rather than being
  // denormalized onto the account — a denormalized copy is one more thing to
  // keep true.
  if (query.productId) filters.push({ subscriptions: { some: { productId: Number(query.productId) } } });
  if (query.planId) filters.push({ subscriptions: { some: { planId: Number(query.planId) } } });
  if (query.subscriptionStatus) {
    filters.push({ subscriptions: { some: { status: { in: String(query.subscriptionStatus).split(",") as any } } } });
  }
  if (query.onboardingStatus) {
    filters.push({ onboardings: { some: { status: { in: String(query.onboardingStatus).split(",") as any } } } });
  }

  const where = { AND: filters };

  const [rows, total] = await Promise.all([
    prisma.account.findMany({
      where,
      orderBy: { [sort.field]: sort.direction },
      skip: page.skip,
      take: page.take,
      select: {
        id: true,
        accountCode: true,
        name: true,
        status: true,
        city: true,
        state: true,
        createdAt: true,
        becameCustomerAt: true,
        owner: { select: { id: true, name: true } },
        subscriptions: {
          where: { status: { notIn: ["CANCELLED", "EXPIRED"] } },
          orderBy: { startDate: "desc" },
          take: 3,
          select: {
            id: true,
            subscriptionCode: true,
            status: true,
            renewalDate: true,
            product: { select: { id: true, key: true, name: true } },
            plan: { select: { id: true, key: true, name: true } },
          },
        },
        onboardings: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true },
        },
        _count: { select: { restaurants: true, contacts: true, subscriptions: true } },
      },
    }),
    prisma.account.count({ where }),
  ]);

  // Outlet counts come from Branch, which is two joins away. Counting them in
  // one grouped query beats N per-row counts on a 100-row page.
  const accountIds = rows.map((row) => row.id);
  const outletCounts = accountIds.length
    ? await prisma.branch.groupBy({
        by: ["restaurantId"],
        where: { isDeleted: false, restaurant: { accountId: { in: accountIds } } },
        _count: { _all: true },
      })
    : [];
  const restaurantOwners = accountIds.length
    ? await prisma.restaurant.findMany({
        where: { accountId: { in: accountIds } },
        select: { id: true, accountId: true },
      })
    : [];
  const outletsByAccount = new Map<number, number>();
  for (const row of outletCounts) {
    const accountId = restaurantOwners.find((r) => r.id === row.restaurantId)?.accountId;
    if (accountId) outletsByAccount.set(accountId, (outletsByAccount.get(accountId) ?? 0) + row._count._all);
  }

  return toPaged(
    rows.map((row) => ({
      ...row,
      outlets: outletsByAccount.get(row.id) ?? 0,
      onboarding: row.onboardings[0] ?? null,
      onboardings: undefined,
    })),
    total,
    page,
  );
};

export const getAccount = async (req: any, accountId: number) => {
  await assertAccountAccess(req, accountId);

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
      subscriptions: {
        orderBy: { startDate: "desc" },
        include: {
          product: { select: { id: true, key: true, name: true } },
          plan: { select: { id: true, key: true, name: true } },
        },
      },
      onboardings: {
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, dueDate: true, goLiveAt: true, completedAt: true },
      },
      restaurants: {
        select: {
          id: true,
          name: true,
          city: true,
          state: true,
          createdAt: true,
          _count: { select: { branches: true, users: true, customers: true } },
        },
      },
      assignments: {
        include: { employee: { select: { id: true, name: true, email: true, employeeCode: true } } },
      },
      _count: { select: { invoices: true, subscriptions: true, contacts: true, opportunities: true } },
    },
  });

  if (!account) throw notFound("No customer with that id.", "ACCOUNT_NOT_FOUND");

  const canSeeFinancial = req.internal?.permissions?.has(PERMISSIONS.ACCOUNT_FINANCIAL_VIEW);

  return {
    ...account,
    // Withheld server-side rather than hidden by the UI: a masked field the API
    // still returned would sit in the network response for anyone who opened
    // developer tools.
    gstNumber: canSeeFinancial ? account.gstNumber : undefined,
    billingAddress: canSeeFinancial ? account.billingAddress : undefined,
    capabilities: { financial: Boolean(canSeeFinancial) },
  };
};

export interface CreateAccountInput {
  name: string;
  legalName?: string | null;
  status?: string;
  ownerId?: number | null;
  billingEmail?: string | null;
  billingPhone?: string | null;
  billingAddress?: string | null;
  gstNumber?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  website?: string | null;
  industrySegment?: string | null;
  notes?: string | null;
  salesStageKey?: string | null;
}

export const createAccount = async (req: any, input: CreateAccountInput) => {
  const name = input.name?.trim();
  if (!name) throw invalidState("Enter the customer's name.", "NAME_REQUIRED");

  const duplicate = await prisma.account.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(input.city ? { city: { equals: input.city, mode: "insensitive" } } : {}),
    },
    select: { id: true, name: true, accountCode: true, city: true },
  });
  if (duplicate) {
    throw conflict(
      `A customer called "${duplicate.name}"${duplicate.city ? ` in ${duplicate.city}` : ""} already exists (${duplicate.accountCode}).`,
      "ACCOUNT_EXISTS",
    );
  }

  const status = (input.status ?? "LEAD") as any;

  return prisma.$transaction(async (tx) => {
    const account = await tx.account.create({
      data: {
        accountCode: await nextAccountCode(tx),
        name,
        legalName: input.legalName?.trim() || null,
        status,
        ownerId: input.ownerId ?? null,
        salesStageKey: input.salesStageKey?.trim() || null,
        billingEmail: input.billingEmail?.trim() || null,
        billingPhone: input.billingPhone?.trim() || null,
        billingAddress: input.billingAddress?.trim() || null,
        gstNumber: input.gstNumber?.trim() || null,
        city: input.city?.trim() || null,
        state: input.state?.trim() || null,
        pincode: input.pincode?.trim() || null,
        website: input.website?.trim() || null,
        industrySegment: input.industrySegment?.trim() || null,
        notes: input.notes?.trim() || null,
        // Only stamped when the account is created already converted, which
        // happens when an existing customer is being recorded retrospectively.
        becameCustomerAt: status === "CUSTOMER" ? new Date() : null,
        createdById: req.internal.id,
      },
    });

    // The creator is assigned to what they create. Without this, an
    // assigned-scope employee would create an account and immediately lose
    // sight of it.
    await tx.accountAssignment.create({
      data: {
        accountId: account.id,
        employeeId: req.internal.id,
        role: "ACCOUNT_MANAGER",
        grantedById: req.internal.id,
      },
    });

    await tx.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.ACCOUNT_CREATED,
        resourceType: "Account",
        resourceId: account.id,
        resourceLabel: account.name,
        newValue: { name, status, city: input.city ?? null },
      }),
    });

    return account;
  });
};

const EDITABLE_FIELDS = [
  "name",
  "legalName",
  "billingEmail",
  "billingPhone",
  "billingAddress",
  "gstNumber",
  "city",
  "state",
  "pincode",
  "website",
  "industrySegment",
  "notes",
  "ownerId",
  "salesStageKey",
] as const;

export const updateAccount = async (req: any, accountId: number, input: Record<string, any>) => {
  await assertAccountAccess(req, accountId);

  const existing = await prisma.account.findUnique({ where: { id: accountId } });
  if (!existing) throw notFound("No customer with that id.", "ACCOUNT_NOT_FOUND");

  // Allowlisted: `status` is deliberately absent so a lifecycle move cannot be
  // smuggled through the general edit endpoint, bypassing its own permission
  // and its own audit action.
  const data: Record<string, any> = {};
  const previous: Record<string, any> = {};
  for (const field of EDITABLE_FIELDS) {
    if (!(field in input)) continue;
    const value = field === "ownerId" ? (input[field] ?? null) : (String(input[field] ?? "").trim() || null);
    if (value === (existing as any)[field]) continue;
    data[field] = value;
    previous[field] = (existing as any)[field];
  }

  if (!Object.keys(data).length) throw invalidState("Nothing to update.", "NO_CHANGES");
  if ("name" in data && !data.name) throw invalidState("Enter the customer's name.", "NAME_REQUIRED");

  const [updated] = await prisma.$transaction([
    prisma.account.update({ where: { id: accountId }, data }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.ACCOUNT_UPDATED,
        resourceType: "Account",
        resourceId: accountId,
        resourceLabel: existing.name,
        previousValue: previous,
        newValue: data,
        reason: input.reason ?? null,
      }),
    }),
  ]);

  return updated;
};

/**
 * Lifecycle transitions.
 *
 * Deliberately not a free-form status write. The permitted moves are the ones
 * that describe a real commercial event; anything else (a churned account
 * silently becoming a lead again) is a mistake worth refusing.
 *
 * CHURNED is reachable from CUSTOMER only — you cannot lose a customer you
 * never had — and re-winning one goes back through CUSTOMER explicitly.
 */
const LIFECYCLE_TRANSITIONS: Record<string, string[]> = {
  LEAD: ["PROSPECT", "CUSTOMER", "CHURNED"],
  PROSPECT: ["CUSTOMER", "LEAD", "CHURNED"],
  CUSTOMER: ["CHURNED"],
  CHURNED: ["CUSTOMER"],
};

export const assertLifecycleTransition = (from: string, to: string, reason?: string | null) => {
  if (from === to) {
    throw invalidState(`This customer is already ${to.toLowerCase()}.`, "STATUS_UNCHANGED");
  }
  const allowed = LIFECYCLE_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw invalidState(
      `A ${from.toLowerCase()} cannot move straight to ${to.toLowerCase()}.`,
      "INVALID_LIFECYCLE_TRANSITION",
      { from, to, allowed },
    );
  }
  // Losing a customer is the one move that must always carry an explanation —
  // churn without a reason is a number nobody can act on.
  if (to === "CHURNED" && !reason?.trim()) {
    throw invalidState("Marking a customer churned needs a reason.", "REASON_REQUIRED");
  }
};

export const setAccountLifecycle = async (
  req: any,
  accountId: number,
  status: string,
  reason?: string | null,
) => {
  await assertAccountAccess(req, accountId);

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) throw notFound("No customer with that id.", "ACCOUNT_NOT_FOUND");

  assertLifecycleTransition(account.status, status, reason);

  const data: Record<string, any> = { status: status as any };
  if (status === "CUSTOMER") {
    // Preserved on re-conversion: the date they first became a customer is the
    // one the cohort analysis needs.
    if (!account.becameCustomerAt) data.becameCustomerAt = new Date();
    data.churnedAt = null;
    data.churnReason = null;
  }
  if (status === "CHURNED") {
    data.churnedAt = new Date();
    data.churnReason = reason?.trim() ?? null;
  }

  const [updated] = await prisma.$transaction([
    prisma.account.update({ where: { id: accountId }, data }),
    // Domain history, written in the same transaction as the change so the two
    // can never disagree. This is what retention and "how many customers did we
    // have in March" are computed from — the audit log answers "who did this",
    // which is a different question and needs a different permission to read.
    prisma.accountLifecycleEvent.create({
      data: {
        accountId,
        fromStatus: account.status,
        toStatus: status as any,
        reason: reason?.trim() ?? null,
        actorId: req.internal.id,
      },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action:
          status === "CUSTOMER"
            ? AUDIT_ACTIONS.ACCOUNT_CONVERTED
            : status === "CHURNED"
              ? AUDIT_ACTIONS.ACCOUNT_CHURNED
              : AUDIT_ACTIONS.ACCOUNT_LIFECYCLE_CHANGED,
        resourceType: "Account",
        resourceId: accountId,
        resourceLabel: account.name,
        previousValue: { status: account.status },
        newValue: { status },
        reason: reason ?? null,
      }),
    }),
  ]);

  return updated;
};

// ─── Contacts ────────────────────────────────────────────────────────────────

export const listContacts = async (req: any, accountId: number) => {
  await assertAccountAccess(req, accountId);
  return prisma.accountContact.findMany({
    where: { accountId },
    orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
  });
};

export const createContact = async (req: any, accountId: number, input: any) => {
  await assertAccountAccess(req, accountId);
  const name = input.name?.trim();
  if (!name) throw invalidState("Enter the contact's name.", "NAME_REQUIRED");
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    throw invalidState("Enter a valid email address.", "INVALID_EMAIL");
  }

  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { name: true } });

  return prisma.$transaction(async (tx) => {
    // One primary per account. Demoting the incumbent inside the same
    // transaction is what keeps that true without a constraint that would make
    // the update order-dependent.
    if (input.isPrimary) {
      await tx.accountContact.updateMany({ where: { accountId, isPrimary: true }, data: { isPrimary: false } });
    }
    const contact = await tx.accountContact.create({
      data: {
        accountId,
        name,
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        designation: input.designation?.trim() || null,
        isPrimary: Boolean(input.isPrimary),
        notes: input.notes?.trim() || null,
      },
    });
    await tx.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.ACCOUNT_CONTACT_CREATED,
        resourceType: "AccountContact",
        resourceId: contact.id,
        resourceLabel: `${account?.name ?? accountId} — ${name}`,
        newValue: { name, email: contact.email, isPrimary: contact.isPrimary },
      }),
    });
    return contact;
  });
};

export const updateContact = async (req: any, accountId: number, contactId: number, input: any) => {
  await assertAccountAccess(req, accountId);
  const existing = await prisma.accountContact.findFirst({ where: { id: contactId, accountId } });
  if (!existing) throw notFound("No contact with that id.", "CONTACT_NOT_FOUND");

  const data: Record<string, any> = {};
  for (const field of ["name", "email", "phone", "designation", "notes"] as const) {
    if (field in input) data[field] = String(input[field] ?? "").trim() || null;
  }
  if ("isPrimary" in input) data.isPrimary = Boolean(input.isPrimary);
  if (!Object.keys(data).length) throw invalidState("Nothing to update.", "NO_CHANGES");
  if ("name" in data && !data.name) throw invalidState("Enter the contact's name.", "NAME_REQUIRED");

  return prisma.$transaction(async (tx) => {
    if (data.isPrimary) {
      await tx.accountContact.updateMany({
        where: { accountId, isPrimary: true, id: { not: contactId } },
        data: { isPrimary: false },
      });
    }
    const contact = await tx.accountContact.update({ where: { id: contactId }, data });
    await tx.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.ACCOUNT_CONTACT_UPDATED,
        resourceType: "AccountContact",
        resourceId: contactId,
        resourceLabel: contact.name,
        previousValue: { name: existing.name, email: existing.email, isPrimary: existing.isPrimary },
        newValue: data,
      }),
    });
    return contact;
  });
};

export const deleteContact = async (req: any, accountId: number, contactId: number) => {
  await assertAccountAccess(req, accountId);
  const existing = await prisma.accountContact.findFirst({ where: { id: contactId, accountId } });
  if (!existing) throw notFound("No contact with that id.", "CONTACT_NOT_FOUND");

  await prisma.$transaction([
    prisma.accountContact.delete({ where: { id: contactId } }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.ACCOUNT_CONTACT_DELETED,
        resourceType: "AccountContact",
        resourceId: contactId,
        resourceLabel: existing.name,
        previousValue: { name: existing.name, email: existing.email },
      }),
    }),
  ]);
  return true;
};

// ─── Locations ───────────────────────────────────────────────────────────────

/**
 * Every outlet the customer runs, across all their restaurant tenants.
 *
 * A location is a Branch. It is presented against the account rather than the
 * restaurant because "how many sites does this customer have" is a commercial
 * question, and for a group with two brands the answer spans both.
 */
export const listLocations = async (req: any, accountId: number) => {
  await assertAccountAccess(req, accountId);

  const branches = await prisma.branch.findMany({
    where: { restaurant: { accountId } },
    orderBy: [{ restaurantId: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      address: true,
      city: true,
      state: true,
      pincode: true,
      phone: true,
      email: true,
      operationalStatus: true,
      isActive: true,
      isDeleted: true,
      createdAt: true,
      restaurant: { select: { id: true, name: true } },
      _count: { select: { tables: true, users: true } },
    },
  });

  return branches;
};

export const setLocationStatus = async (
  req: any,
  accountId: number,
  branchId: number,
  status: string,
  reason?: string | null,
) => {
  await assertAccountAccess(req, accountId);

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, restaurant: { accountId } },
    select: { id: true, name: true, operationalStatus: true },
  });
  if (!branch) throw notFound("No location with that id.", "LOCATION_NOT_FOUND");

  if (!["ACTIVE", "INACTIVE", "CLOSED"].includes(status)) {
    throw invalidState("That is not a valid location status.", "INVALID_STATUS");
  }
  if (branch.operationalStatus === status) {
    throw invalidState(`${branch.name} is already ${status.toLowerCase()}.`, "STATUS_UNCHANGED");
  }

  const [updated] = await prisma.$transaction([
    prisma.branch.update({
      where: { id: branchId },
      data: {
        operationalStatus: status as any,
        // isActive is what the restaurant-facing apps read. Keeping it in step
        // means the console and the product never disagree about whether an
        // outlet is trading.
        isActive: status === "ACTIVE",
      },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.LOCATION_STATUS_CHANGED,
        resourceType: "Branch",
        resourceId: branchId,
        resourceLabel: branch.name,
        previousValue: { operationalStatus: branch.operationalStatus },
        newValue: { operationalStatus: status },
        reason: reason ?? null,
      }),
    }),
  ]);

  return updated;
};

// ─── Assignments ─────────────────────────────────────────────────────────────

export const listAssignments = async (req: any, accountId: number) => {
  await assertAccountAccess(req, accountId);
  return prisma.accountAssignment.findMany({
    where: { accountId },
    include: { employee: { select: { id: true, name: true, email: true, employeeCode: true, department: true } } },
    orderBy: { createdAt: "asc" },
  });
};

export const assignEmployee = async (req: any, accountId: number, employeeId: number, role?: string | null) => {
  await assertAccountAccess(req, accountId);

  const [account, employee] = await Promise.all([
    prisma.account.findUnique({ where: { id: accountId }, select: { name: true } }),
    prisma.internalUser.findUnique({ where: { id: employeeId }, select: { id: true, name: true, status: true } }),
  ]);
  if (!account) throw notFound("No customer with that id.", "ACCOUNT_NOT_FOUND");
  if (!employee) throw notFound("No employee with that id.", "EMPLOYEE_NOT_FOUND");
  if (employee.status !== "ACTIVE") {
    throw invalidState(`${employee.name} is not an active employee.`, "EMPLOYEE_NOT_ACTIVE");
  }

  const existing = await prisma.accountAssignment.findUnique({
    where: { accountId_employeeId: { accountId, employeeId } },
  });
  if (existing) throw conflict(`${employee.name} is already assigned to this customer.`, "ALREADY_ASSIGNED");

  const [assignment] = await prisma.$transaction([
    prisma.accountAssignment.create({
      data: { accountId, employeeId, role: role?.trim() || null, grantedById: req.internal.id },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        // Assigning someone to an account grants them access to that customer's
        // data, so it is audited as the access grant it is.
        action: AUDIT_ACTIONS.ACCOUNT_ASSIGNMENT_GRANTED,
        resourceType: "Account",
        resourceId: accountId,
        resourceLabel: account.name,
        newValue: { employeeId, employeeName: employee.name, role: role ?? null },
      }),
    }),
  ]);

  return assignment;
};

export const unassignEmployee = async (req: any, accountId: number, employeeId: number) => {
  await assertAccountAccess(req, accountId);

  const existing = await prisma.accountAssignment.findUnique({
    where: { accountId_employeeId: { accountId, employeeId } },
    include: { employee: { select: { name: true } }, account: { select: { name: true } } },
  });
  if (!existing) throw notFound("That employee is not assigned to this customer.", "ASSIGNMENT_NOT_FOUND");

  await prisma.$transaction([
    prisma.accountAssignment.delete({ where: { id: existing.id } }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.ACCOUNT_ASSIGNMENT_REVOKED,
        resourceType: "Account",
        resourceId: accountId,
        resourceLabel: existing.account.name,
        previousValue: { employeeId, employeeName: existing.employee.name },
      }),
    }),
  ]);
  return true;
};

/** Distinct cities and owners, for the list screen's filter dropdowns. */
export const getAccountFilterOptions = async (req: any) => {
  const where = accountWhere(req);
  const [cities, owners] = await Promise.all([
    prisma.account.findMany({
      where: { ...where, city: { not: null } },
      select: { city: true },
      distinct: ["city"],
      orderBy: { city: "asc" },
      take: 200,
    }),
    prisma.account.findMany({
      where: { ...where, ownerId: { not: null } },
      select: { owner: { select: { id: true, name: true } } },
      distinct: ["ownerId"],
      take: 200,
    }),
  ]);

  return {
    cities: cities.map((row) => row.city).filter(Boolean),
    owners: owners.map((row) => row.owner).filter(Boolean),
    statuses: ["LEAD", "PROSPECT", "CUSTOMER", "CHURNED"],
  };
};
