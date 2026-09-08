import prisma from "../../../config/prisma";
import { AUDIT_ACTIONS, auditData } from "../audit/audit.service";
import { invalidState, notFound } from "../shared/apiError";
import { parsePage, toPaged } from "../shared/pagination";
import { assertAccountAccess, relatedAccountWhere } from "../rbac/scope";

/**
 * Customer onboarding.
 *
 * Re-hung from the restaurant onto the account, because onboarding is something
 * a *customer* goes through after buying — not something an outlet has. A group
 * with four sites onboards once.
 *
 * The status set is the delivery lifecycle and nothing else:
 *
 *   NOT_STARTED → IN_PROGRESS → READY_FOR_GO_LIVE → LIVE → COMPLETED
 *                      ↕
 *                   BLOCKED
 *
 * It is deliberately independent of the account's commercial state and of the
 * subscription's billing state. All three used to be one column on Restaurant,
 * which is why a signed-and-paying customer mid-configuration was
 * indistinguishable from a cold lead.
 *
 * The checklist comes from OnboardingTemplateTask rather than a hard-coded
 * array, so a product can eventually carry its own steps. Rows are materialised
 * per onboarding at creation, so changing the template never rewrites the
 * checklist a customer was actually held to.
 */

const TRANSITIONS: Record<string, string[]> = {
  NOT_STARTED: ["IN_PROGRESS", "BLOCKED"],
  IN_PROGRESS: ["BLOCKED", "READY_FOR_GO_LIVE"],
  BLOCKED: ["IN_PROGRESS", "NOT_STARTED"],
  // READY_FOR_GO_LIVE does not lead to LIVE here. Going live runs through
  // `goLive`, which additionally enforces the mandatory checklist — the same
  // separation the restaurant activation gate had, kept because it works.
  READY_FOR_GO_LIVE: ["IN_PROGRESS", "BLOCKED"],
  LIVE: ["COMPLETED", "IN_PROGRESS"],
  COMPLETED: [],
};

export const assertOnboardingTransition = (from: string, to: string, reason?: string | null) => {
  if (from === to) {
    throw invalidState(`Onboarding is already ${to.replace(/_/g, " ").toLowerCase()}.`, "STATUS_UNCHANGED");
  }
  if (to === "LIVE") {
    throw invalidState(
      "Use Go live — it checks the mandatory onboarding steps first.",
      "USE_GO_LIVE_ACTION",
    );
  }
  const allowed = TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw invalidState(
      from === "COMPLETED"
        ? "This onboarding is complete."
        : `Onboarding can't move from ${from.replace(/_/g, " ").toLowerCase()} straight to ${to.replace(/_/g, " ").toLowerCase()}.`,
      "INVALID_ONBOARDING_TRANSITION",
      { from, to, allowed },
    );
  }
  // A blocked onboarding without a stated blocker is just a stalled one nobody
  // can pick up.
  if (to === "BLOCKED" && !reason?.trim()) {
    throw invalidState("Say what's blocking it.", "REASON_REQUIRED");
  }
};

/** The template for a product, falling back to the default (productId null). */
export const templateFor = async (productId?: number | null) => {
  if (productId) {
    const specific = await prisma.onboardingTemplateTask.findMany({
      where: { productId },
      orderBy: { sortOrder: "asc" },
    });
    if (specific.length) return specific;
  }
  return prisma.onboardingTemplateTask.findMany({
    where: { productId: null },
    orderBy: { sortOrder: "asc" },
  });
};

const summarise = (tasks: { status: string; isMandatory: boolean; key: string; label: string }[]) => {
  const mandatory = tasks.filter((task) => task.isMandatory);
  const done = (task: { status: string }) => task.status === "COMPLETE" || task.status === "NOT_APPLICABLE";
  const blockers = mandatory.filter((task) => !done(task)).map((task) => ({ key: task.key, label: task.label }));
  return {
    total: tasks.length,
    complete: tasks.filter(done).length,
    mandatoryTotal: mandatory.length,
    mandatoryComplete: mandatory.filter(done).length,
    blockers,
    percent: tasks.length ? Math.round((tasks.filter(done).length / tasks.length) * 100) : 0,
  };
};

export const listOnboardings = async (req: any, query: any) => {
  const page = parsePage(query);

  const filters: any[] = [relatedAccountWhere(req)];
  if (query.status) filters.push({ status: { in: String(query.status).split(",") as any } });
  if (query.assignedToId === "none") filters.push({ assignedToId: null });
  else if (query.assignedToId) filters.push({ assignedToId: Number(query.assignedToId) });
  if (query.accountId) filters.push({ accountId: Number(query.accountId) });
  if (query.overdue === "true") {
    filters.push({ dueDate: { lt: new Date() }, status: { notIn: ["LIVE", "COMPLETED"] } });
  }
  const term = query.search?.trim();
  if (term) {
    filters.push({
      OR: [
        { account: { name: { contains: term, mode: "insensitive" } } },
        { account: { accountCode: { contains: term, mode: "insensitive" } } },
      ],
    });
  }

  const where = { AND: filters };

  const [rows, total] = await Promise.all([
    prisma.onboarding.findMany({
      where,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      skip: page.skip,
      take: page.take,
      include: {
        account: { select: { id: true, accountCode: true, name: true, status: true, city: true } },
        assignedTo: { select: { id: true, name: true } },
        subscription: {
          select: {
            id: true,
            subscriptionCode: true,
            product: { select: { key: true, name: true } },
            plan: { select: { key: true, name: true } },
          },
        },
        tasks: { select: { status: true, isMandatory: true, key: true, label: true } },
      },
    }),
    prisma.onboarding.count({ where }),
  ]);

  return toPaged(
    rows.map((row) => ({ ...row, tasks: undefined, summary: summarise(row.tasks) })),
    total,
    page,
  );
};

/** Counts per status, for the onboarding board's column headers. */
export const getOnboardingCounts = async (req: any) => {
  const rows = await prisma.onboarding.groupBy({
    by: ["status"],
    where: relatedAccountWhere(req),
    _count: { _all: true },
  });
  const counts = Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
  return {
    NOT_STARTED: counts.NOT_STARTED ?? 0,
    IN_PROGRESS: counts.IN_PROGRESS ?? 0,
    BLOCKED: counts.BLOCKED ?? 0,
    READY_FOR_GO_LIVE: counts.READY_FOR_GO_LIVE ?? 0,
    LIVE: counts.LIVE ?? 0,
    COMPLETED: counts.COMPLETED ?? 0,
  };
};

export const getOnboarding = async (req: any, onboardingId: number) => {
  const onboarding = await prisma.onboarding.findUnique({
    where: { id: onboardingId },
    include: {
      account: { select: { id: true, accountCode: true, name: true, status: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
      subscription: {
        select: {
          id: true,
          subscriptionCode: true,
          status: true,
          product: { select: { id: true, key: true, name: true } },
          plan: { select: { id: true, key: true, name: true } },
        },
      },
      tasks: {
        orderBy: { sortOrder: "asc" },
        include: {
          assignedTo: { select: { id: true, name: true } },
          completedBy: { select: { id: true, name: true } },
        },
      },
      events: {
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { actor: { select: { id: true, name: true } } },
      },
    },
  });
  if (!onboarding) throw notFound("No onboarding with that id.", "ONBOARDING_NOT_FOUND");
  await assertAccountAccess(req, onboarding.accountId);

  return {
    ...onboarding,
    summary: summarise(onboarding.tasks),
    allowedTransitions: TRANSITIONS[onboarding.status] ?? [],
  };
};

/** The onboarding for an account, creating one on first read if none exists. */
export const getAccountOnboarding = async (req: any, accountId: number) => {
  await assertAccountAccess(req, accountId);
  const existing = await prisma.onboarding.findFirst({
    where: { accountId },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return getOnboarding(req, existing.id);

  const created = await startOnboarding(req, { accountId });
  return getOnboarding(req, created.id);
};

export const startOnboarding = async (
  req: any,
  input: { accountId: number; subscriptionId?: number | null; assignedToId?: number | null; dueDate?: Date | null },
) => {
  await assertAccountAccess(req, input.accountId);

  const account = await prisma.account.findUnique({
    where: { id: input.accountId },
    select: { id: true, name: true },
  });
  if (!account) throw notFound("No customer with that id.", "ACCOUNT_NOT_FOUND");

  let productId: number | null = null;
  if (input.subscriptionId) {
    const subscription = await prisma.subscription.findUnique({
      where: { id: input.subscriptionId },
      select: { accountId: true, productId: true },
    });
    if (!subscription) throw notFound("No subscription with that id.", "SUBSCRIPTION_NOT_FOUND");
    if (subscription.accountId !== input.accountId) {
      throw invalidState("That subscription belongs to a different customer.", "SUBSCRIPTION_ACCOUNT_MISMATCH");
    }
    productId = subscription.productId;
  }

  const template = await templateFor(productId);
  if (!template.length) {
    // Without a template the checklist would be empty, and an empty checklist
    // makes the go-live gate pass trivially for exactly the customers it most
    // needs to check.
    throw invalidState(
      "No onboarding template is configured, so a checklist can't be created.",
      "ONBOARDING_TEMPLATE_MISSING",
    );
  }

  return prisma.$transaction(async (tx) => {
    const onboarding = await tx.onboarding.create({
      data: {
        accountId: input.accountId,
        subscriptionId: input.subscriptionId ?? null,
        status: "NOT_STARTED",
        assignedToId: input.assignedToId ?? null,
        dueDate: input.dueDate ?? null,
        createdById: req.internal.id,
        tasks: {
          create: template.map((task) => ({
            key: task.key,
            label: task.label,
            category: task.category,
            isMandatory: task.isMandatory,
            sortOrder: task.sortOrder,
          })),
        },
      },
    });

    await tx.onboardingEvent.create({
      data: { onboardingId: onboarding.id, type: "STATUS_CHANGED", toValue: "NOT_STARTED", actorId: req.internal.id },
    });

    await tx.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.ONBOARDING_STARTED,
        resourceType: "Onboarding",
        resourceId: onboarding.id,
        resourceLabel: account.name,
        newValue: { accountId: input.accountId, tasks: template.length },
      }),
    });

    return onboarding;
  });
};

export const setOnboardingStatus = async (
  req: any,
  onboardingId: number,
  status: string,
  reason?: string | null,
) => {
  const existing = await prisma.onboarding.findUnique({
    where: { id: onboardingId },
    include: { account: { select: { name: true } } },
  });
  if (!existing) throw notFound("No onboarding with that id.", "ONBOARDING_NOT_FOUND");
  await assertAccountAccess(req, existing.accountId);

  assertOnboardingTransition(existing.status, status, reason);

  const data: Record<string, any> = { status: status as any };
  if (status === "IN_PROGRESS" && !existing.startedAt) data.startedAt = new Date();
  if (status === "BLOCKED") data.blockedReason = reason?.trim() ?? null;
  if (existing.status === "BLOCKED" && status !== "BLOCKED") data.blockedReason = null;
  if (status === "COMPLETED") data.completedAt = new Date();

  const [updated] = await prisma.$transaction([
    prisma.onboarding.update({ where: { id: onboardingId }, data }),
    prisma.onboardingEvent.create({
      data: {
        onboardingId,
        type: status === "BLOCKED" ? "BLOCKED" : "STATUS_CHANGED",
        fromValue: existing.status,
        toValue: status,
        message: reason?.trim() || null,
        actorId: req.internal.id,
      },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.ONBOARDING_STATUS_CHANGED,
        resourceType: "Onboarding",
        resourceId: onboardingId,
        resourceLabel: existing.account.name,
        previousValue: { status: existing.status },
        newValue: { status },
        reason: reason ?? null,
      }),
    }),
  ]);

  return updated;
};

/**
 * Takes a customer live.
 *
 * Gated on every mandatory checklist item, and — belt and braces — on the
 * checklist existing at all. An empty checklist produces zero blockers, which
 * would read as "everything complete" and wave through exactly the customers
 * the gate exists to catch.
 */
export const goLive = async (req: any, onboardingId: number, reason?: string | null) => {
  const onboarding = await prisma.onboarding.findUnique({
    where: { id: onboardingId },
    include: { account: { select: { id: true, name: true, status: true } }, tasks: true },
  });
  if (!onboarding) throw notFound("No onboarding with that id.", "ONBOARDING_NOT_FOUND");
  await assertAccountAccess(req, onboarding.accountId);

  if (onboarding.status === "LIVE" || onboarding.status === "COMPLETED") {
    throw invalidState(`${onboarding.account.name} is already live.`, "ALREADY_LIVE");
  }

  const summary = summarise(onboarding.tasks);
  if (summary.mandatoryTotal === 0) {
    throw invalidState(
      `${onboarding.account.name} has no onboarding checklist, so readiness can't be verified.`,
      "ONBOARDING_CHECKLIST_MISSING",
    );
  }
  if (summary.blockers.length) {
    throw invalidState(
      `${onboarding.account.name} can't go live yet — ${summary.blockers.length} mandatory step${
        summary.blockers.length === 1 ? "" : "s"
      } outstanding.`,
      "ONBOARDING_INCOMPLETE",
      { blockers: summary.blockers },
    );
  }

  const [updated] = await prisma.$transaction([
    prisma.onboarding.update({
      where: { id: onboardingId },
      data: { status: "LIVE", goLiveAt: new Date(), blockedReason: null },
    }),
    prisma.onboardingEvent.create({
      data: {
        onboardingId,
        type: "STATUS_CHANGED",
        fromValue: onboarding.status,
        toValue: "LIVE",
        message: reason?.trim() || null,
        actorId: req.internal.id,
      },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.ONBOARDING_WENT_LIVE,
        resourceType: "Onboarding",
        resourceId: onboardingId,
        resourceLabel: onboarding.account.name,
        previousValue: { status: onboarding.status },
        newValue: { status: "LIVE" },
        reason: reason ?? null,
      }),
    }),
  ]);

  return updated;
};

export const assignOnboarding = async (req: any, onboardingId: number, assignedToId: number | null) => {
  const existing = await prisma.onboarding.findUnique({
    where: { id: onboardingId },
    include: { account: { select: { name: true } }, assignedTo: { select: { name: true } } },
  });
  if (!existing) throw notFound("No onboarding with that id.", "ONBOARDING_NOT_FOUND");
  await assertAccountAccess(req, existing.accountId);

  if (assignedToId) {
    const employee = await prisma.internalUser.findUnique({
      where: { id: assignedToId },
      select: { id: true, name: true, status: true },
    });
    if (!employee) throw notFound("No employee with that id.", "EMPLOYEE_NOT_FOUND");
    if (employee.status !== "ACTIVE") {
      throw invalidState(`${employee.name} is not an active employee.`, "EMPLOYEE_NOT_ACTIVE");
    }
  }

  const [updated] = await prisma.$transaction([
    prisma.onboarding.update({ where: { id: onboardingId }, data: { assignedToId } }),
    prisma.onboardingEvent.create({
      data: {
        onboardingId,
        type: "ASSIGNED",
        fromValue: existing.assignedTo?.name ?? null,
        toValue: assignedToId ? String(assignedToId) : null,
        actorId: req.internal.id,
      },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.ONBOARDING_ASSIGNED,
        resourceType: "Onboarding",
        resourceId: onboardingId,
        resourceLabel: existing.account.name,
        previousValue: { assignedToId: existing.assignedToId },
        newValue: { assignedToId },
      }),
    }),
  ]);
  return updated;
};

export const updateOnboarding = async (req: any, onboardingId: number, input: any) => {
  const existing = await prisma.onboarding.findUnique({
    where: { id: onboardingId },
    include: { account: { select: { name: true } } },
  });
  if (!existing) throw notFound("No onboarding with that id.", "ONBOARDING_NOT_FOUND");
  await assertAccountAccess(req, existing.accountId);

  const data: Record<string, any> = {};
  if ("dueDate" in input) data.dueDate = input.dueDate ?? null;
  if ("notes" in input) data.notes = input.notes ?? null;
  if (!Object.keys(data).length) throw invalidState("Nothing to update.", "NO_CHANGES");

  return prisma.onboarding.update({ where: { id: onboardingId }, data });
};

export const updateTask = async (req: any, onboardingId: number, taskKey: string, input: any) => {
  const onboarding = await prisma.onboarding.findUnique({
    where: { id: onboardingId },
    include: { account: { select: { name: true } } },
  });
  if (!onboarding) throw notFound("No onboarding with that id.", "ONBOARDING_NOT_FOUND");
  await assertAccountAccess(req, onboarding.accountId);

  const task = await prisma.onboardingTask.findUnique({
    where: { onboardingId_key: { onboardingId, key: taskKey } },
  });
  if (!task) throw notFound("No such onboarding step.", "TASK_NOT_FOUND");

  const data: Record<string, any> = {};
  if (input.status) {
    if (!["PENDING", "IN_PROGRESS", "COMPLETE", "BLOCKED", "NOT_APPLICABLE"].includes(input.status)) {
      throw invalidState("That is not a valid step status.", "INVALID_STATUS");
    }
    data.status = input.status;
    if (input.status === "COMPLETE") {
      data.completedAt = new Date();
      data.completedById = req.internal.id;
    } else {
      data.completedAt = null;
      data.completedById = null;
    }
  }
  if ("notes" in input) data.notes = input.notes?.trim() || null;
  if ("dueDate" in input) data.dueDate = input.dueDate ?? null;
  if ("assignedToId" in input) data.assignedToId = input.assignedToId ?? null;
  if (!Object.keys(data).length) throw invalidState("Nothing to update.", "NO_CHANGES");

  const [updated] = await prisma.$transaction([
    prisma.onboardingTask.update({ where: { id: task.id }, data }),
    prisma.onboardingEvent.create({
      data: {
        onboardingId,
        type: "TASK_UPDATED",
        fromValue: task.status,
        toValue: data.status ?? task.status,
        message: task.label,
        actorId: req.internal.id,
      },
    }),
  ]);

  // Reaching every mandatory step is a state change worth surfacing, so the
  // onboarding moves itself to READY_FOR_GO_LIVE rather than waiting for
  // someone to notice and click it.
  const tasks = await prisma.onboardingTask.findMany({ where: { onboardingId } });
  const summary = summarise(tasks);
  if (
    summary.blockers.length === 0 &&
    summary.mandatoryTotal > 0 &&
    (onboarding.status === "IN_PROGRESS" || onboarding.status === "NOT_STARTED")
  ) {
    await prisma.$transaction([
      prisma.onboarding.update({ where: { id: onboardingId }, data: { status: "READY_FOR_GO_LIVE" } }),
      prisma.onboardingEvent.create({
        data: {
          onboardingId,
          type: "STATUS_CHANGED",
          fromValue: onboarding.status,
          toValue: "READY_FOR_GO_LIVE",
          message: "Every mandatory step is complete.",
          actorId: req.internal.id,
        },
      }),
    ]);
  } else if (onboarding.status === "NOT_STARTED") {
    await prisma.onboarding.update({
      where: { id: onboardingId },
      data: { status: "IN_PROGRESS", startedAt: new Date() },
    });
  }

  return updated;
};
