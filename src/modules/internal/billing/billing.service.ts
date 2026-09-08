import prisma from "../../../config/prisma";
import { AUDIT_ACTIONS, auditData } from "../audit/audit.service";
import { invalidState, notFound } from "../shared/apiError";
import { parsePage, parseSort, toPaged } from "../shared/pagination";
import { nextCreditNoteNo, nextInvoiceNo, nextPaymentNo } from "../shared/ids";
import { assertAccountAccess, relatedAccountWhere } from "../rbac/scope";

/**
 * Billing — customers paying DineInk for their subscriptions.
 *
 * Deliberately not the `Bill` model, which is a diner paying a restaurant. The
 * two were previously conflated in the dashboard's revenue framing, which is
 * how a restaurant's takings ended up presented as DineInk's income.
 *
 * No payment gateway is integrated and none is assumed. Finance records what
 * was invoiced and what arrived; the shape is such that a gateway can populate
 * the same rows later without a migration.
 *
 * Nothing is computed that Dineink has not defined: no tax rate, no due-date
 * rule, no dunning schedule, no late fee. Tax is entered as charged, the due
 * date is entered by whoever raises the invoice, and OVERDUE is derived purely
 * from that date having passed — which is arithmetic, not policy.
 */

const INVOICE_SORT_FIELDS = ["issueDate", "dueDate", "total", "createdAt", "status"] as const;
const PAYMENT_SORT_FIELDS = ["receivedAt", "amount", "createdAt"] as const;

const money = (value: unknown) => Number(value ?? 0);

const serializeInvoice = (invoice: any) => ({
  ...invoice,
  subtotal: money(invoice.subtotal),
  taxAmount: invoice.taxAmount === null || invoice.taxAmount === undefined ? null : money(invoice.taxAmount),
  total: money(invoice.total),
  amountPaid: money(invoice.amountPaid),
  amountDue: Math.max(0, money(invoice.total) - money(invoice.amountPaid)),
  lines: invoice.lines?.map((line: any) => ({
    ...line,
    quantity: money(line.quantity),
    unitAmount: money(line.unitAmount),
    amount: money(line.amount),
  })),
  payments: invoice.payments?.map((payment: any) => ({ ...payment, amount: money(payment.amount) })),
  creditNotes: invoice.creditNotes?.map((note: any) => ({ ...note, amount: money(note.amount) })),
});

/**
 * OVERDUE is a derived presentation state, not a stored one.
 *
 * Storing it would need a nightly job to keep true, and would be wrong for
 * every hour between the due date passing and that job running. Deriving it on
 * read is always correct and costs nothing.
 */
const withDerivedStatus = (invoice: any) => {
  const isOpen = invoice.status === "ISSUED" || invoice.status === "PARTIALLY_PAID";
  const overdue = isOpen && invoice.dueDate && new Date(invoice.dueDate) < new Date();
  return { ...invoice, isOverdue: Boolean(overdue), displayStatus: overdue ? "OVERDUE" : invoice.status };
};

// ─── Invoices ────────────────────────────────────────────────────────────────

export interface InvoiceListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  accountId?: number;
  subscriptionId?: number;
  overdue?: string;
  from?: string;
  to?: string;
  sortBy?: string;
  sortDir?: string;
}

export const listInvoices = async (req: any, query: InvoiceListQuery) => {
  const page = parsePage(query);
  const sort = parseSort(query, INVOICE_SORT_FIELDS, "issueDate");

  const filters: any[] = [relatedAccountWhere(req)];

  if (query.status) filters.push({ status: { in: String(query.status).split(",") as any } });
  if (query.accountId) filters.push({ accountId: Number(query.accountId) });
  if (query.subscriptionId) filters.push({ subscriptionId: Number(query.subscriptionId) });
  if (query.from || query.to) {
    filters.push({
      issueDate: {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
      },
    });
  }
  // "Overdue" is the same derivation as above, expressed as a filter so the
  // list can be narrowed in SQL rather than after pagination.
  if (query.overdue === "true") {
    filters.push({ status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: new Date() } });
  }

  const term = query.search?.trim();
  if (term) {
    filters.push({
      OR: [
        { invoiceNo: { contains: term, mode: "insensitive" } },
        { account: { name: { contains: term, mode: "insensitive" } } },
        { account: { accountCode: { contains: term, mode: "insensitive" } } },
      ],
    });
  }

  const where = { AND: filters };

  const [rows, total, totals] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { [sort.field]: sort.direction },
      skip: page.skip,
      take: page.take,
      include: {
        account: { select: { id: true, accountCode: true, name: true } },
        subscription: { select: { id: true, subscriptionCode: true } },
      },
    }),
    prisma.invoice.count({ where }),
    prisma.invoice.aggregate({ where, _sum: { total: true, amountPaid: true } }),
  ]);

  return {
    ...toPaged(rows.map((row) => withDerivedStatus(serializeInvoice(row))), total, page),
    // Totals for the whole filtered set, not just the visible page — otherwise
    // the figure changes as you page through, which reads as a bug.
    totals: {
      invoiced: money(totals._sum.total),
      collected: money(totals._sum.amountPaid),
      outstanding: Math.max(0, money(totals._sum.total) - money(totals._sum.amountPaid)),
    },
  };
};

export const getInvoice = async (req: any, invoiceId: number) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      account: { select: { id: true, accountCode: true, name: true, gstNumber: true, billingEmail: true } },
      subscription: {
        select: {
          id: true,
          subscriptionCode: true,
          product: { select: { key: true, name: true } },
          plan: { select: { key: true, name: true } },
        },
      },
      lines: { orderBy: { sortOrder: "asc" } },
      payments: { orderBy: { receivedAt: "desc" } },
      creditNotes: { orderBy: { issuedAt: "desc" } },
    },
  });
  if (!invoice) throw notFound("No invoice with that number.", "INVOICE_NOT_FOUND");
  await assertAccountAccess(req, invoice.accountId);
  return withDerivedStatus(serializeInvoice(invoice));
};

export interface InvoiceLineInput {
  description: string;
  quantity: number;
  unitAmount: number;
}

export interface CreateInvoiceInput {
  accountId: number;
  subscriptionId?: number | null;
  issueDate?: Date | null;
  dueDate?: Date | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  currency?: string;
  taxAmount?: number | null;
  taxNotes?: string | null;
  notes?: string | null;
  lines: InvoiceLineInput[];
}

/**
 * Creates a DRAFT invoice.
 *
 * Always draft: an invoice becomes real when someone issues it, which is a
 * separate permission and a separate audit entry. That split is what makes a
 * mistake recoverable — a draft can be edited, an issued invoice can only be
 * voided.
 */
export const createInvoice = async (req: any, input: CreateInvoiceInput) => {
  await assertAccountAccess(req, input.accountId);

  const account = await prisma.account.findUnique({
    where: { id: input.accountId },
    select: { id: true, name: true },
  });
  if (!account) throw notFound("No customer with that id.", "ACCOUNT_NOT_FOUND");

  if (!input.lines?.length) throw invalidState("An invoice needs at least one line.", "LINES_REQUIRED");

  if (input.subscriptionId) {
    const subscription = await prisma.subscription.findUnique({
      where: { id: input.subscriptionId },
      select: { accountId: true },
    });
    if (!subscription) throw notFound("No subscription with that id.", "SUBSCRIPTION_NOT_FOUND");
    // An invoice billed to one customer for another's subscription would be
    // both a data error and a privacy one.
    if (subscription.accountId !== input.accountId) {
      throw invalidState("That subscription belongs to a different customer.", "SUBSCRIPTION_ACCOUNT_MISMATCH");
    }
  }

  const lines = input.lines.map((line, index) => {
    const quantity = Number(line.quantity ?? 1);
    const unitAmount = Number(line.unitAmount);
    if (!line.description?.trim()) throw invalidState("Every line needs a description.", "LINE_DESCRIPTION_REQUIRED");
    if (!Number.isFinite(quantity) || quantity <= 0) throw invalidState("Quantity must be greater than zero.", "INVALID_QUANTITY");
    if (!Number.isFinite(unitAmount) || unitAmount < 0) throw invalidState("A line amount can't be negative.", "INVALID_AMOUNT");
    return {
      description: line.description.trim(),
      quantity,
      unitAmount,
      // Rounded per line rather than once at the end, so the printed lines add
      // up to the printed total. A customer checking the arithmetic by hand
      // must not find it off by a paisa.
      amount: Math.round(quantity * unitAmount * 100) / 100,
      sortOrder: index,
    };
  });

  const subtotal = Math.round(lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
  const taxAmount = input.taxAmount === null || input.taxAmount === undefined ? null : Number(input.taxAmount);
  const total = Math.round((subtotal + (taxAmount ?? 0)) * 100) / 100;

  const invoice = await prisma.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        invoiceNo: await nextInvoiceNo(tx),
        accountId: input.accountId,
        subscriptionId: input.subscriptionId ?? null,
        status: "DRAFT",
        issueDate: input.issueDate ?? null,
        dueDate: input.dueDate ?? null,
        periodStart: input.periodStart ?? null,
        periodEnd: input.periodEnd ?? null,
        subtotal,
        taxAmount,
        taxNotes: input.taxNotes?.trim() || null,
        total,
        currency: input.currency ?? "INR",
        notes: input.notes?.trim() || null,
        createdById: req.internal.id,
        lines: { create: lines.map((line) => ({ ...line, subscriptionId: input.subscriptionId ?? null })) },
      },
      include: { lines: true },
    });

    await tx.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.INVOICE_CREATED,
        resourceType: "Invoice",
        resourceId: created.id,
        resourceLabel: `${created.invoiceNo} — ${account.name}`,
        newValue: { total, currency: created.currency, lines: lines.length },
      }),
    });

    return created;
  });

  return serializeInvoice(invoice);
};

export const issueInvoice = async (req: any, invoiceId: number, issueDate?: Date | null, dueDate?: Date | null) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { account: { select: { name: true } } },
  });
  if (!invoice) throw notFound("No invoice with that number.", "INVOICE_NOT_FOUND");
  await assertAccountAccess(req, invoice.accountId);

  if (invoice.status !== "DRAFT") {
    throw invalidState(`${invoice.invoiceNo} has already been issued.`, "ALREADY_ISSUED");
  }
  if (money(invoice.total) <= 0) {
    throw invalidState("An invoice for zero can't be issued.", "ZERO_INVOICE");
  }

  const finalIssueDate = issueDate ?? invoice.issueDate ?? new Date();
  const finalDueDate = dueDate ?? invoice.dueDate ?? null;
  // No default payment term is invented. Dineink has not stated one, so an
  // invoice may be issued without a due date and simply never becomes overdue.
  if (finalDueDate && finalDueDate < finalIssueDate) {
    throw invalidState("The due date can't be before the issue date.", "INVALID_DUE_DATE");
  }

  const [updated] = await prisma.$transaction([
    prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: "ISSUED", issueDate: finalIssueDate, dueDate: finalDueDate },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.INVOICE_ISSUED,
        resourceType: "Invoice",
        resourceId: invoiceId,
        resourceLabel: `${invoice.invoiceNo} — ${invoice.account.name}`,
        previousValue: { status: "DRAFT" },
        newValue: { status: "ISSUED", issueDate: finalIssueDate, dueDate: finalDueDate },
      }),
    }),
  ]);

  return serializeInvoice(updated);
};

export const voidInvoice = async (req: any, invoiceId: number, reason: string) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { account: { select: { name: true } }, payments: { where: { status: "SUCCEEDED" } } },
  });
  if (!invoice) throw notFound("No invoice with that number.", "INVOICE_NOT_FOUND");
  await assertAccountAccess(req, invoice.accountId);

  if (invoice.status === "VOID") throw invalidState(`${invoice.invoiceNo} is already void.`, "ALREADY_VOID");
  if (!reason?.trim()) throw invalidState("Voiding an invoice needs a reason.", "REASON_REQUIRED");
  // Voiding a paid invoice would leave money recorded against a document that
  // no longer exists. A credit note is the correct instrument for that.
  if (invoice.payments.length > 0) {
    throw invalidState(
      `${invoice.invoiceNo} has payments recorded against it. Issue a credit note instead of voiding it.`,
      "INVOICE_HAS_PAYMENTS",
    );
  }

  const [updated] = await prisma.$transaction([
    prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: "VOID", voidedAt: new Date(), voidReason: reason.trim() },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.INVOICE_VOIDED,
        resourceType: "Invoice",
        resourceId: invoiceId,
        resourceLabel: `${invoice.invoiceNo} — ${invoice.account.name}`,
        previousValue: { status: invoice.status },
        newValue: { status: "VOID" },
        reason: reason.trim(),
      }),
    }),
  ]);

  return serializeInvoice(updated);
};

// ─── Payments ────────────────────────────────────────────────────────────────

export const listPayments = async (req: any, query: any) => {
  const page = parsePage(query);
  const sort = parseSort(query, PAYMENT_SORT_FIELDS, "receivedAt");

  const filters: any[] = [relatedAccountWhere(req)];
  if (query.status) filters.push({ status: { in: String(query.status).split(",") as any } });
  if (query.accountId) filters.push({ accountId: Number(query.accountId) });
  if (query.invoiceId) filters.push({ invoiceId: Number(query.invoiceId) });
  if (query.from || query.to) {
    filters.push({
      receivedAt: {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
      },
    });
  }
  const term = query.search?.trim();
  if (term) {
    filters.push({
      OR: [
        { paymentNo: { contains: term, mode: "insensitive" } },
        { reference: { contains: term, mode: "insensitive" } },
        { account: { name: { contains: term, mode: "insensitive" } } },
      ],
    });
  }

  const where = { AND: filters };
  const [rows, total, sum] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { [sort.field]: sort.direction },
      skip: page.skip,
      take: page.take,
      include: {
        account: { select: { id: true, accountCode: true, name: true } },
        invoice: { select: { id: true, invoiceNo: true } },
      },
    }),
    prisma.payment.count({ where }),
    prisma.payment.aggregate({ where: { AND: [...filters, { status: "SUCCEEDED" }] }, _sum: { amount: true } }),
  ]);

  return {
    ...toPaged(rows.map((row) => ({ ...row, amount: money(row.amount) })), total, page),
    totals: { received: money(sum._sum.amount) },
  };
};

/**
 * Records a payment and re-derives the invoice's paid state.
 *
 * `amountPaid` on the invoice is a running total maintained here rather than a
 * sum computed on read, because it is filtered and sorted on. It is recomputed
 * from the payments in the same transaction, so it cannot drift from them.
 */
export const recordPayment = async (req: any, input: any) => {
  const accountId = Number(input.accountId);
  await assertAccountAccess(req, accountId);

  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { name: true } });
  if (!account) throw notFound("No customer with that id.", "ACCOUNT_NOT_FOUND");

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw invalidState("Enter a payment amount greater than zero.", "INVALID_AMOUNT");
  }

  let invoice = null;
  if (input.invoiceId) {
    invoice = await prisma.invoice.findUnique({ where: { id: Number(input.invoiceId) } });
    if (!invoice) throw notFound("No invoice with that number.", "INVOICE_NOT_FOUND");
    if (invoice.accountId !== accountId) {
      throw invalidState("That invoice belongs to a different customer.", "INVOICE_ACCOUNT_MISMATCH");
    }
    if (invoice.status === "DRAFT") {
      throw invalidState("Issue the invoice before recording a payment against it.", "INVOICE_NOT_ISSUED");
    }
    if (invoice.status === "VOID") {
      throw invalidState("That invoice is void.", "INVOICE_VOID");
    }
  }

  const status = (input.status ?? "SUCCEEDED") as string;

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        paymentNo: await nextPaymentNo(tx),
        accountId,
        invoiceId: invoice?.id ?? null,
        amount,
        currency: input.currency ?? invoice?.currency ?? "INR",
        status: status as any,
        method: input.method?.trim() || null,
        reference: input.reference?.trim() || null,
        receivedAt: input.receivedAt ?? new Date(),
        failureReason: status === "FAILED" ? (input.failureReason?.trim() || null) : null,
        notes: input.notes?.trim() || null,
        recordedById: req.internal.id,
      },
    });

    if (invoice) {
      // Only successful payments count towards the invoice. A failed attempt is
      // still recorded — Finance needs to see it — but must not mark anything paid.
      const paidAgg = await tx.payment.aggregate({
        where: { invoiceId: invoice.id, status: "SUCCEEDED" },
        _sum: { amount: true },
      });
      const amountPaid = money(paidAgg._sum.amount);
      const total = money(invoice.total);
      const nextStatus =
        amountPaid >= total ? "PAID" : amountPaid > 0 ? "PARTIALLY_PAID" : invoice.status;

      await tx.invoice.update({
        where: { id: invoice.id },
        data: { amountPaid, status: nextStatus as any },
      });
    }

    await tx.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.PAYMENT_RECORDED,
        resourceType: "Payment",
        resourceId: payment.id,
        resourceLabel: `${payment.paymentNo} — ${account.name}`,
        newValue: {
          amount,
          currency: payment.currency,
          status,
          invoice: invoice?.invoiceNo ?? null,
          method: payment.method,
        },
      }),
    });

    return { ...payment, amount: money(payment.amount) };
  });
};

// ─── Credit notes ────────────────────────────────────────────────────────────

export const listCreditNotes = async (req: any, query: any) => {
  const page = parsePage(query);
  const filters: any[] = [relatedAccountWhere(req)];
  if (query.accountId) filters.push({ accountId: Number(query.accountId) });
  if (query.invoiceId) filters.push({ invoiceId: Number(query.invoiceId) });

  const where = { AND: filters };
  const [rows, total] = await Promise.all([
    prisma.creditNote.findMany({
      where,
      orderBy: { issuedAt: "desc" },
      skip: page.skip,
      take: page.take,
      include: {
        account: { select: { id: true, accountCode: true, name: true } },
        invoice: { select: { id: true, invoiceNo: true } },
      },
    }),
    prisma.creditNote.count({ where }),
  ]);

  return toPaged(rows.map((row) => ({ ...row, amount: money(row.amount) })), total, page);
};

/**
 * Issues a credit against an invoice.
 *
 * The SaaS counterpart to a refund. Named for what it is rather than reusing
 * "refund", which in this codebase already means a restaurant refunding a diner
 * (`BillRefund`) — two very different movements of money.
 *
 * It records the credit; it does not move money. Whether a credit is paid back
 * or set against the next invoice is a policy Dineink has not defined.
 */
export const issueCreditNote = async (req: any, input: any) => {
  const accountId = Number(input.accountId);
  await assertAccountAccess(req, accountId);

  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { name: true } });
  if (!account) throw notFound("No customer with that id.", "ACCOUNT_NOT_FOUND");

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw invalidState("Enter a credit amount greater than zero.", "INVALID_AMOUNT");
  }
  if (!input.reason?.trim()) throw invalidState("A credit note needs a reason.", "REASON_REQUIRED");

  let invoice = null;
  if (input.invoiceId) {
    invoice = await prisma.invoice.findUnique({
      where: { id: Number(input.invoiceId) },
      include: { creditNotes: { where: { status: { not: "VOID" } } } },
    });
    if (!invoice) throw notFound("No invoice with that number.", "INVOICE_NOT_FOUND");
    if (invoice.accountId !== accountId) {
      throw invalidState("That invoice belongs to a different customer.", "INVOICE_ACCOUNT_MISMATCH");
    }
    // Crediting more than was ever charged turns the ledger negative in a way
    // no downstream report expects.
    const alreadyCredited = invoice.creditNotes.reduce((sum, note) => sum + money(note.amount), 0);
    if (alreadyCredited + amount > money(invoice.total)) {
      throw invalidState(
        `That would credit more than ${invoice.invoiceNo} was raised for (${money(invoice.total)}, already credited ${alreadyCredited}).`,
        "CREDIT_EXCEEDS_INVOICE",
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const note = await tx.creditNote.create({
      data: {
        creditNoteNo: await nextCreditNoteNo(tx),
        accountId,
        invoiceId: invoice?.id ?? null,
        amount,
        currency: input.currency ?? invoice?.currency ?? "INR",
        reason: input.reason.trim(),
        issuedAt: input.issuedAt ?? new Date(),
        createdById: req.internal.id,
      },
    });

    await tx.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.CREDIT_NOTE_ISSUED,
        resourceType: "CreditNote",
        resourceId: note.id,
        resourceLabel: `${note.creditNoteNo} — ${account.name}`,
        newValue: { amount, currency: note.currency, invoice: invoice?.invoiceNo ?? null },
        reason: input.reason.trim(),
      }),
    });

    return { ...note, amount: money(note.amount) };
  });
};

/** Everything billing-related for one account, for the account's Billing tab. */
export const getAccountBilling = async (req: any, accountId: number) => {
  await assertAccountAccess(req, accountId);

  const [invoices, payments, creditNotes, totals] = await Promise.all([
    prisma.invoice.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { subscription: { select: { id: true, subscriptionCode: true } } },
    }),
    prisma.payment.findMany({
      where: { accountId },
      orderBy: { receivedAt: "desc" },
      take: 50,
      include: { invoice: { select: { id: true, invoiceNo: true } } },
    }),
    prisma.creditNote.findMany({
      where: { accountId },
      orderBy: { issuedAt: "desc" },
      take: 50,
      include: { invoice: { select: { id: true, invoiceNo: true } } },
    }),
    prisma.invoice.aggregate({
      where: { accountId, status: { notIn: ["DRAFT", "VOID"] } },
      _sum: { total: true, amountPaid: true },
    }),
  ]);

  const invoiced = money(totals._sum.total);
  const collected = money(totals._sum.amountPaid);

  return {
    invoices: invoices.map((row) => withDerivedStatus(serializeInvoice(row))),
    payments: payments.map((row) => ({ ...row, amount: money(row.amount) })),
    creditNotes: creditNotes.map((row) => ({ ...row, amount: money(row.amount) })),
    totals: { invoiced, collected, outstanding: Math.max(0, invoiced - collected) },
  };
};
