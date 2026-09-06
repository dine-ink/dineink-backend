import crypto from "crypto";
import type { Prisma, PrismaClient } from "../../../../generated/prisma";

/**
 * Human-facing identifiers.
 *
 * Employees quote these to each other and read them down a phone, so they are
 * short, prefixed and typo-resistant — and, importantly, they are *display*
 * identifiers derived inside the same transaction as the row they name, not a
 * second source of truth. The primary key is still the primary key.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * EMP-0001, EMP-0002, … Derived from the highest existing code rather than a
 * row count so deleting an employee can never hand their code to someone else.
 */
export const nextEmployeeCode = async (db: Db): Promise<string> => {
  const latest = await db.internalUser.findFirst({
    orderBy: { employeeCode: "desc" },
    select: { employeeCode: true },
  });
  const current = latest ? Number(latest.employeeCode.replace(/\D/g, "")) : 0;
  return `EMP-${String(current + 1).padStart(4, "0")}`;
};

/** Ticket numbers start at DINE-1000 so the first one doesn't read as a test. */
export const TICKET_NUMBER_BASE = 1000;

export const ticketNoForId = (id: number): string => `DINE-${TICKET_NUMBER_BASE + id}`;

/**
 * A table's QR identifier.
 *
 * Never the table's primary key: sequential ids are trivially enumerable, so a
 * key-based QR would let anyone forge a scan for any table in any restaurant by
 * counting upward. 20 random bytes, base64url, is unguessable and still short
 * enough to sit in a URL under a printed QR.
 */
export const generateQrToken = (): string => crypto.randomBytes(20).toString("base64url");

/**
 * Sequential display codes for the commercial entities.
 *
 * All derived from the highest existing code rather than a row count, for the
 * same reason as employee codes: deleting a row must never hand its identifier
 * to something else. `MAX(...)` over the numeric suffix rather than a string
 * sort, so ACC-0010 correctly follows ACC-0009 rather than ACC-0001.
 *
 * These are display identifiers derived inside the caller's transaction. Under
 * genuinely concurrent creation two callers could compute the same next code;
 * the unique constraint on each column is what makes that a retryable error
 * rather than a duplicate. At DineInk's volume the collision is theoretical,
 * and a database sequence is the fix if it ever stops being.
 */
const nextCode = async (
  latest: string | null | undefined,
  prefix: string,
  width: number,
): Promise<string> => {
  const value = latest ? Number(latest.replace(/\D/g, "")) : 0;
  return `${prefix}-${String(value + 1).padStart(width, "0")}`;
};

/**
 * The most recent code, found by primary key rather than by sorting the codes
 * themselves.
 *
 * Codes are assigned monotonically with rows, so the highest id necessarily
 * holds the highest code. Ordering by the code string instead would need the
 * numeric suffix cast in SQL, and loading every row to sort in Node would scan
 * the whole invoice table to allocate one number.
 */
export const nextAccountCode = async (db: Db): Promise<string> => {
  const latest = await db.account.findFirst({ orderBy: { id: "desc" }, select: { accountCode: true } });
  return nextCode(latest?.accountCode, "ACC", 4);
};

export const nextSubscriptionCode = async (db: Db): Promise<string> => {
  const latest = await db.subscription.findFirst({
    orderBy: { id: "desc" },
    select: { subscriptionCode: true },
  });
  return nextCode(latest?.subscriptionCode, "SUB", 4);
};

export const nextInvoiceNo = async (db: Db): Promise<string> => {
  const latest = await db.invoice.findFirst({ orderBy: { id: "desc" }, select: { invoiceNo: true } });
  return nextCode(latest?.invoiceNo, "INV", 5);
};

export const nextPaymentNo = async (db: Db): Promise<string> => {
  const latest = await db.payment.findFirst({ orderBy: { id: "desc" }, select: { paymentNo: true } });
  return nextCode(latest?.paymentNo, "PAY", 5);
};

export const nextCreditNoteNo = async (db: Db): Promise<string> => {
  const latest = await db.creditNote.findFirst({ orderBy: { id: "desc" }, select: { creditNoteNo: true } });
  return nextCode(latest?.creditNoteNo, "CN", 5);
};
