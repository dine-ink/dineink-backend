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
