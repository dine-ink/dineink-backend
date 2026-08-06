import QRCode from "qrcode";
import prisma from "../../config/prisma";
import { ForbiddenError } from "./banking.validation";

// ── Bank Accounts ─────────────────────────────────────────────────────────────

export const getBankAccountsService = async (restaurantId: number, branchId?: number) => {
  return prisma.bankAccount.findMany({
    where: {
      restaurantId,
      // Same convention as EMI schedules — branchId omitted entirely means
      // "all branches" (including restaurant-wide accounts, branchId null);
      // a specific branchId filters down to just that branch's accounts.
      ...(branchId !== undefined ? { branchId } : {}),
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
  });
};

export const createBankAccountService = async (
  callerRestaurantId: number,
  data: {
    branchId?: number | null;
    accountHolderName: string;
    bankName: string;
    accountNumberMasked: string;
    ifsc: string;
    isPrimary?: boolean;
  },
) => {
  if (data.isPrimary) {
    return prisma.$transaction(async (tx) => {
      // Only one primary account per restaurant — clear any existing
      // primary flag before creating this one so the invariant holds.
      await tx.bankAccount.updateMany({
        where: { restaurantId: callerRestaurantId, isPrimary: true },
        data: { isPrimary: false },
      });
      return tx.bankAccount.create({
        data: {
          restaurantId: callerRestaurantId,
          branchId: data.branchId ?? null,
          accountHolderName: data.accountHolderName,
          bankName: data.bankName,
          accountNumberMasked: data.accountNumberMasked,
          ifsc: data.ifsc,
          isPrimary: true,
        },
      });
    });
  }

  return prisma.bankAccount.create({
    data: {
      restaurantId: callerRestaurantId,
      branchId: data.branchId ?? null,
      accountHolderName: data.accountHolderName,
      bankName: data.bankName,
      accountNumberMasked: data.accountNumberMasked,
      ifsc: data.ifsc,
      isPrimary: false,
    },
  });
};

export const updateBankAccountService = async (
  callerRestaurantId: number,
  id: number,
  data: Partial<{
    branchId: number | null;
    accountHolderName: string;
    bankName: string;
    accountNumberMasked: string;
    ifsc: string;
    isPrimary: boolean;
    isActive: boolean;
  }>,
) => {
  const existing = await prisma.bankAccount.findUnique({ where: { id }, select: { restaurantId: true } });
  if (!existing) throw new Error("Bank account not found");
  if (existing.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this bank account");
  }

  if (data.isPrimary) {
    return prisma.$transaction(async (tx) => {
      // Clear the flag on every other account of this restaurant first —
      // excluding this row avoids a pointless self-update racing the real one.
      await tx.bankAccount.updateMany({
        where: { restaurantId: callerRestaurantId, isPrimary: true, id: { not: id } },
        data: { isPrimary: false },
      });
      return tx.bankAccount.update({ where: { id }, data });
    });
  }

  return prisma.bankAccount.update({ where: { id }, data });
};

export const deleteBankAccountService = async (callerRestaurantId: number, id: number) => {
  const existing = await prisma.bankAccount.findUnique({ where: { id }, select: { restaurantId: true } });
  if (!existing) throw new Error("Bank account not found");
  if (existing.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this bank account");
  }
  return prisma.bankAccount.delete({ where: { id } });
};

// ── UPI Config ────────────────────────────────────────────────────────────────

export const getUpiConfigService = async (restaurantId: number, branchId: number) => {
  return prisma.upiConfig.findFirst({ where: { restaurantId, branchId } });
};

export const upsertUpiConfigService = async (
  callerRestaurantId: number,
  data: { branchId: number; upiId: string; displayName: string },
) => {
  const branch = await prisma.branch.findUnique({
    where: { id: data.branchId },
    select: { restaurantId: true },
  });
  if (!branch || branch.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this branch");
  }

  return prisma.upiConfig.upsert({
    where: { branchId: data.branchId },
    update: {
      upiId: data.upiId,
      displayName: data.displayName,
      restaurantId: callerRestaurantId,
    },
    create: {
      restaurantId: callerRestaurantId,
      branchId: data.branchId,
      upiId: data.upiId,
      displayName: data.displayName,
    },
  });
};

// Builds a standard UPI-intent deep link and renders it as a QR code. This
// is deliberately NOT a payment-gateway integration — there is no live
// collection request, callback, or webhook involved. It just encodes the
// restaurant's own static UPI ID into the same `upi://pay?...` URI any UPI
// app already knows how to scan, so a customer's UPI app opens with the
// payee + amount fields pre-filled and the guest still confirms/pays
// manually from their own banking app.
export const generateUpiQrService = async (restaurantId: number, branchId: number) => {
  const config = await prisma.upiConfig.findFirst({ where: { restaurantId, branchId } });
  if (!config || !config.isActive) {
    throw new Error("No UPI ID configured for this branch");
  }

  const upiLink =
    `upi://pay?pa=${encodeURIComponent(config.upiId)}` +
    `&pn=${encodeURIComponent(config.displayName)}` +
    `&cu=INR`;

  const qrCodeDataUrl = await QRCode.toDataURL(upiLink);

  return {
    upiId: config.upiId,
    displayName: config.displayName,
    qrCodeDataUrl,
    upiLink,
  };
};

// ── Bank Transactions (manual entry / reconciliation) ────────────────────────

export const getBankTransactionsService = async (
  restaurantId: number,
  branchId: number,
  from?: string,
  to?: string,
) => {
  const dateFilter =
    from && to
      ? { entryDate: { gte: new Date(from), lte: new Date(to + "T23:59:59.999Z") } }
      : {};

  return prisma.bankTransactionEntry.findMany({
    where: { restaurantId, branchId, ...dateFilter },
    orderBy: { entryDate: "desc" },
  });
};

export const createBankTransactionService = async (
  callerRestaurantId: number,
  data: {
    branchId: number;
    bankAccountId?: number | null;
    entryDate: string;
    description?: string;
    amount: number;
    type: string;
    notes?: string;
    createdById?: number;
  },
) => {
  const branch = await prisma.branch.findUnique({
    where: { id: data.branchId },
    select: { restaurantId: true },
  });
  if (!branch || branch.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this branch");
  }

  return prisma.bankTransactionEntry.create({
    data: {
      restaurantId: callerRestaurantId,
      branchId: data.branchId,
      bankAccountId: data.bankAccountId ?? null,
      entryDate: new Date(data.entryDate),
      description: data.description,
      amount: data.amount,
      type: data.type,
      notes: data.notes,
      createdById: data.createdById,
    },
  });
};

export const updateBankTransactionService = async (
  callerRestaurantId: number,
  id: number,
  data: Partial<{
    bankAccountId: number | null;
    entryDate: string;
    description: string;
    amount: number;
    type: string;
    reconciliationStatus: string;
    matchedBillId: number | null;
    matchedVendorPaymentId: number | null;
    notes: string;
  }>,
) => {
  const existing = await prisma.bankTransactionEntry.findUnique({
    where: { id },
    select: { restaurantId: true },
  });
  if (!existing) throw new Error("Bank transaction entry not found");
  if (existing.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this bank transaction entry");
  }

  const { entryDate, ...rest } = data;
  return prisma.bankTransactionEntry.update({
    where: { id },
    data: {
      ...rest,
      ...(entryDate !== undefined ? { entryDate: new Date(entryDate) } : {}),
    },
  });
};

export const deleteBankTransactionService = async (callerRestaurantId: number, id: number) => {
  const existing = await prisma.bankTransactionEntry.findUnique({
    where: { id },
    select: { restaurantId: true },
  });
  if (!existing) throw new Error("Bank transaction entry not found");
  if (existing.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this bank transaction entry");
  }
  return prisma.bankTransactionEntry.delete({ where: { id } });
};

// ── Reconciliation ────────────────────────────────────────────────────────────

const AMOUNT_TOLERANCE = 1; // ±₹1
const DATE_TOLERANCE_MS = 2 * 24 * 60 * 60 * 1000; // ±2 days

// Best-effort amount+date heuristic matcher — this is explicitly NOT a live
// payment-gateway webhook reconciliation (there is no gateway in this
// module at all, see generateUpiQrService above). It just looks at manually
// entered bank statement lines and guesses which existing Bill (for
// customer-paid CREDIT entries) or VendorPayment (for outgoing DEBIT
// entries) they most likely correspond to, based on amount within a small
// tolerance and date within a small window. A human can always review/undo
// via updateBankTransactionService since this never touches Bill/VendorPayment
// rows themselves — it only stamps matchedBillId/matchedVendorPaymentId and
// reconciliationStatus on the BankTransactionEntry.
export const reconcileTransactionsService = async (callerRestaurantId: number, branchId: number) => {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { restaurantId: true },
  });
  if (!branch || branch.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this branch");
  }

  const unmatched = await prisma.bankTransactionEntry.findMany({
    where: { restaurantId: callerRestaurantId, branchId, reconciliationStatus: "UNMATCHED" },
  });

  if (unmatched.length === 0) {
    return { matched: 0, stillUnmatched: 0 };
  }

  // IDs of Bill/VendorPayment rows already claimed by some other entry in
  // this branch, so two unmatched transactions don't both grab the same
  // underlying record.
  const alreadyMatched = await prisma.bankTransactionEntry.findMany({
    where: {
      restaurantId: callerRestaurantId,
      branchId,
      reconciliationStatus: "MATCHED",
      OR: [{ matchedBillId: { not: null } }, { matchedVendorPaymentId: { not: null } }],
    },
    select: { matchedBillId: true, matchedVendorPaymentId: true },
  });
  const claimedBillIds = new Set(alreadyMatched.map((m) => m.matchedBillId).filter((v): v is number => v != null));
  const claimedVendorPaymentIds = new Set(
    alreadyMatched.map((m) => m.matchedVendorPaymentId).filter((v): v is number => v != null),
  );

  // Bound the candidate fetch to the date window actually spanned by the
  // unmatched entries (±tolerance) instead of pulling every Bill/
  // VendorPayment the branch has ever recorded — a long-lived restaurant's
  // full history has no natural cap otherwise.
  const entryTimes = unmatched.map((e) => new Date(e.entryDate).getTime());
  const windowStart = new Date(Math.min(...entryTimes) - DATE_TOLERANCE_MS);
  const windowEnd = new Date(Math.max(...entryTimes) + DATE_TOLERANCE_MS);

  const [candidateBills, candidatePayments] = await Promise.all([
    prisma.bill.findMany({
      where: { restaurantId: callerRestaurantId, branchId, createdAt: { gte: windowStart, lte: windowEnd } },
    }),
    prisma.vendorPayment.findMany({
      where: { restaurantId: callerRestaurantId, branchId, paymentDate: { gte: windowStart, lte: windowEnd } },
    }),
  ]);

  let matched = 0;

  for (const entry of unmatched) {
    if (entry.type === "CREDIT") {
      const bill = candidateBills.find(
        (b) =>
          !claimedBillIds.has(b.id) &&
          Math.abs(b.total - entry.amount) <= AMOUNT_TOLERANCE &&
          Math.abs(new Date(b.createdAt).getTime() - new Date(entry.entryDate).getTime()) <= DATE_TOLERANCE_MS,
      );
      if (bill) {
        claimedBillIds.add(bill.id);
        await prisma.bankTransactionEntry.update({
          where: { id: entry.id },
          data: { matchedBillId: bill.id, reconciliationStatus: "MATCHED" },
        });
        matched += 1;
      }
    } else if (entry.type === "DEBIT") {
      const payment = candidatePayments.find(
        (p) =>
          !claimedVendorPaymentIds.has(p.id) &&
          Math.abs(p.amount - entry.amount) <= AMOUNT_TOLERANCE &&
          Math.abs(new Date(p.paymentDate).getTime() - new Date(entry.entryDate).getTime()) <= DATE_TOLERANCE_MS,
      );
      if (payment) {
        claimedVendorPaymentIds.add(payment.id);
        await prisma.bankTransactionEntry.update({
          where: { id: entry.id },
          data: { matchedVendorPaymentId: payment.id, reconciliationStatus: "MATCHED" },
        });
        matched += 1;
      }
    }
  }

  return { matched, stillUnmatched: unmatched.length - matched };
};
