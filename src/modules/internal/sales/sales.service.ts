import prisma from "../../../config/prisma";
import { AUDIT_ACTIONS, auditData } from "../audit/audit.service";
import { invalidState, notFound } from "../shared/apiError";
import { parsePage, toPaged } from "../shared/pagination";
import { assertAccountAccess, relatedAccountWhere } from "../rbac/scope";

/**
 * Sales — deliberately small.
 *
 * Leads and prospects are Accounts in a pre-customer lifecycle state, not a
 * parallel entity. That is the whole design: converting a lead is a status
 * change on a row that already holds the contacts, the notes and the history,
 * so nothing is copied and nothing is left behind in a "leads" table pointing
 * at a customer.
 *
 * Only the deal needs a row of its own, because one account can be in several
 * conversations at once (RDS for the flagship, Dot for the smaller sites).
 *
 * The pipeline itself is data (`SalesStage`), not an enum. Dineink has not
 * ratified its stages, so they are seeded from the brief and editable without a
 * migration. Nothing here computes a forecast, a probability or a commission —
 * none of those rules exist yet.
 */

export const listStages = () =>
  prisma.salesStage.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });

const serialize = (opportunity: any) => ({
  ...opportunity,
  amount: opportunity.amount === null || opportunity.amount === undefined ? null : Number(opportunity.amount),
});

export const listOpportunities = async (req: any, query: any) => {
  const page = parsePage(query);

  const filters: any[] = [relatedAccountWhere(req)];
  if (query.stageId) filters.push({ stageId: Number(query.stageId) });
  if (query.ownerId === "none") filters.push({ ownerId: null });
  else if (query.ownerId) filters.push({ ownerId: Number(query.ownerId) });
  if (query.accountId) filters.push({ accountId: Number(query.accountId) });
  if (query.productId) filters.push({ productId: Number(query.productId) });
  if (query.open === "true") filters.push({ closedAt: null });

  const term = query.search?.trim();
  if (term) {
    filters.push({
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { account: { name: { contains: term, mode: "insensitive" } } },
        { account: { accountCode: { contains: term, mode: "insensitive" } } },
      ],
    });
  }

  const where = { AND: filters };

  const [rows, total] = await Promise.all([
    prisma.opportunity.findMany({
      where,
      orderBy: [{ closedAt: "asc" }, { expectedCloseDate: "asc" }, { createdAt: "desc" }],
      skip: page.skip,
      take: page.take,
      include: {
        account: { select: { id: true, accountCode: true, name: true, status: true } },
        stage: { select: { id: true, key: true, name: true, isWon: true, isLost: true } },
        owner: { select: { id: true, name: true } },
        product: { select: { id: true, key: true, name: true } },
        plan: { select: { id: true, key: true, name: true } },
      },
    }),
    prisma.opportunity.count({ where }),
  ]);

  return toPaged(rows.map(serialize), total, page);
};

/** Deal counts per stage, for the pipeline board. */
export const getPipeline = async (req: any) => {
  const [stages, counts] = await Promise.all([
    listStages(),
    prisma.opportunity.groupBy({
      by: ["stageId"],
      where: { AND: [relatedAccountWhere(req), { closedAt: null }] },
      _count: { _all: true },
      // Summed only where a value was entered. Most deals have none, because
      // Dineink has not supplied pricing — the count is the real signal here.
      _sum: { amount: true },
    }),
  ]);

  const byStage = new Map(counts.map((row) => [row.stageId, row]));
  return stages.map((stage) => ({
    ...stage,
    count: byStage.get(stage.id)?._count._all ?? 0,
    value: byStage.get(stage.id)?._sum.amount ? Number(byStage.get(stage.id)!._sum.amount) : null,
  }));
};

export const getOpportunity = async (req: any, opportunityId: number) => {
  const opportunity = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    include: {
      account: {
        select: { id: true, accountCode: true, name: true, status: true, city: true },
      },
      stage: true,
      owner: { select: { id: true, name: true, email: true } },
      product: { select: { id: true, key: true, name: true } },
      plan: { select: { id: true, key: true, name: true } },
    },
  });
  if (!opportunity) throw notFound("No opportunity with that id.", "OPPORTUNITY_NOT_FOUND");
  await assertAccountAccess(req, opportunity.accountId);
  return serialize(opportunity);
};

export const createOpportunity = async (req: any, input: any) => {
  await assertAccountAccess(req, Number(input.accountId));

  const [account, stage] = await Promise.all([
    prisma.account.findUnique({ where: { id: Number(input.accountId) }, select: { id: true, name: true } }),
    prisma.salesStage.findUnique({ where: { id: Number(input.stageId) } }),
  ]);
  if (!account) throw notFound("No customer with that id.", "ACCOUNT_NOT_FOUND");
  if (!stage) throw notFound("No such pipeline stage.", "STAGE_NOT_FOUND");

  if (input.planId) {
    const plan = await prisma.plan.findUnique({ where: { id: Number(input.planId) }, select: { productId: true } });
    if (!plan) throw notFound("No plan with that id.", "PLAN_NOT_FOUND");
    if (input.productId && plan.productId !== Number(input.productId)) {
      throw invalidState("That plan belongs to a different product.", "PLAN_PRODUCT_MISMATCH");
    }
  }

  // Interactive transaction rather than the array form: the audit entry needs
  // the opportunity's id, which does not exist until the insert has run.
  const opportunity = await prisma.$transaction(async (tx) => {
    const created = await tx.opportunity.create({
      data: {
        accountId: Number(input.accountId),
        name: input.name.trim(),
        stageId: stage.id,
        ownerId: input.ownerId ?? req.internal.id,
        productId: input.productId ?? null,
        planId: input.planId ?? null,
        amount: input.amount ?? null,
        currency: input.currency?.trim()?.toUpperCase() || null,
        expectedCloseDate: input.expectedCloseDate ?? null,
        notes: input.notes ?? null,
        createdById: req.internal.id,
      },
    });

    await tx.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.OPPORTUNITY_CREATED,
        resourceType: "Opportunity",
        resourceId: created.id,
        resourceLabel: `${account.name} — ${created.name}`,
        newValue: { account: account.name, stage: stage.key, amount: input.amount ?? null },
      }),
    });

    return created;
  });

  return serialize(opportunity);
};

export const updateOpportunity = async (req: any, opportunityId: number, input: any) => {
  const existing = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    include: { account: { select: { name: true } } },
  });
  if (!existing) throw notFound("No opportunity with that id.", "OPPORTUNITY_NOT_FOUND");
  await assertAccountAccess(req, existing.accountId);

  const data: Record<string, any> = {};
  if ("name" in input && input.name) data.name = input.name.trim();
  for (const field of ["notes", "lostReason"] as const) {
    if (field in input) data[field] = input[field] ?? null;
  }
  for (const field of ["ownerId", "productId", "planId"] as const) {
    if (field in input) data[field] = input[field] ?? null;
  }
  if ("amount" in input) data.amount = input.amount ?? null;
  if ("currency" in input) data.currency = input.currency?.trim()?.toUpperCase() || null;
  if ("expectedCloseDate" in input) data.expectedCloseDate = input.expectedCloseDate ?? null;
  if (!Object.keys(data).length) throw invalidState("Nothing to update.", "NO_CHANGES");

  const [opportunity] = await prisma.$transaction([
    prisma.opportunity.update({ where: { id: opportunityId }, data }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.OPPORTUNITY_UPDATED,
        resourceType: "Opportunity",
        resourceId: opportunityId,
        resourceLabel: `${existing.account.name} — ${existing.name}`,
        previousValue: { name: existing.name, amount: existing.amount ? Number(existing.amount) : null },
        newValue: data,
      }),
    }),
  ]);
  return serialize(opportunity);
};

/**
 * Moves a deal along the pipeline.
 *
 * Reaching a stage flagged `isWon` converts the account to CUSTOMER in the same
 * transaction — that is the one place the sales pipeline and the commercial
 * lifecycle genuinely meet, and doing it here means the two can never disagree.
 * A lost deal closes without touching the account: losing one conversation does
 * not make the account a lost cause.
 */
export const setOpportunityStage = async (
  req: any,
  opportunityId: number,
  stageId: number,
  reason?: string | null,
) => {
  const existing = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    include: { account: { select: { id: true, name: true, status: true } }, stage: true },
  });
  if (!existing) throw notFound("No opportunity with that id.", "OPPORTUNITY_NOT_FOUND");
  await assertAccountAccess(req, existing.accountId);

  const stage = await prisma.salesStage.findUnique({ where: { id: stageId } });
  if (!stage) throw notFound("No such pipeline stage.", "STAGE_NOT_FOUND");
  if (stage.id === existing.stageId) {
    throw invalidState(`This deal is already at ${stage.name}.`, "STAGE_UNCHANGED");
  }
  if (stage.isLost && !reason?.trim()) {
    throw invalidState("Marking a deal lost needs a reason.", "REASON_REQUIRED");
  }

  const writes: any[] = [
    prisma.opportunity.update({
      where: { id: opportunityId },
      data: {
        stageId,
        closedAt: stage.isWon || stage.isLost ? new Date() : null,
        lostReason: stage.isLost ? (reason?.trim() ?? null) : null,
      },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.OPPORTUNITY_STAGE_CHANGED,
        resourceType: "Opportunity",
        resourceId: opportunityId,
        resourceLabel: `${existing.account.name} — ${existing.name}`,
        previousValue: { stage: existing.stage.key },
        newValue: { stage: stage.key },
        reason: reason ?? null,
      }),
    }),
  ];

  if (stage.isWon && existing.account.status !== "CUSTOMER") {
    writes.push(
      prisma.account.update({
        where: { id: existing.accountId },
        data: {
          status: "CUSTOMER",
          becameCustomerAt: new Date(),
          churnedAt: null,
          churnReason: null,
        },
      }),
      prisma.accountLifecycleEvent.create({
        data: {
          accountId: existing.accountId,
          fromStatus: existing.account.status,
          toStatus: "CUSTOMER",
          reason: `Won: ${existing.name}`,
          actorId: req.internal.id,
        },
      }),
      prisma.internalAuditLog.create({
        data: auditData(req, {
          action: AUDIT_ACTIONS.ACCOUNT_CONVERTED,
          resourceType: "Account",
          resourceId: existing.accountId,
          resourceLabel: existing.account.name,
          previousValue: { status: existing.account.status },
          newValue: { status: "CUSTOMER" },
          reason: `Won: ${existing.name}`,
        }),
      }),
    );
  }

  const [opportunity] = await prisma.$transaction(writes);
  return serialize(opportunity);
};
