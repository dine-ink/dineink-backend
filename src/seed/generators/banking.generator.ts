import type { BankAccount, BankTransactionEntry, Branch, Prisma, UpiConfig } from "../../../generated/prisma";
import type { SeedConfig } from "../config";
import type { SeedContext } from "../context";
import {
  addDays,
  batchCreateManyAndReturn,
  type Db,
  faker,
  historyMonths,
  pickOne,
  randomInt,
  randomMoney,
  sampleUnique,
  slugify,
  weightedPick,
} from "../utils";

export interface BankingSeedResult {
  bankAccounts: BankAccount[];
  upiConfigs: UpiConfig[];
  bankTransactionEntries: BankTransactionEntry[];
}

// Indian bank name + IFSC-prefix pool — fabricated but realistic-looking
// (real IFSC format is 4 letters + "0" + 6 alphanumeric).
const BANK_POOL: Array<{ name: string; ifscPrefix: string }> = [
  { name: "HDFC Bank", ifscPrefix: "HDFC" },
  { name: "ICICI Bank", ifscPrefix: "ICIC" },
  { name: "State Bank of India", ifscPrefix: "SBIN" },
  { name: "Axis Bank", ifscPrefix: "UTIB" },
];

function maskedAccountNumber(): string {
  return `XXXXXX${faker.string.numeric(4)}`;
}

function fabricatedIfsc(prefix: string): string {
  return `${prefix}0${faker.string.numeric(6)}`;
}

async function ensureBankAccounts(db: Db, ctx: SeedContext): Promise<BankAccount[]> {
  const rows: Prisma.BankAccountCreateManyInput[] = [];

  const primaryBank = pickOne(BANK_POOL);
  rows.push({
    restaurantId: ctx.restaurant.id,
    branchId: null,
    accountHolderName: ctx.restaurant.name,
    bankName: primaryBank.name,
    accountNumberMasked: maskedAccountNumber(),
    ifsc: fabricatedIfsc(primaryBank.ifscPrefix),
    isPrimary: true,
    isActive: true,
  });

  for (const branchCtx of ctx.branches) {
    const bank = pickOne(BANK_POOL);
    rows.push({
      restaurantId: ctx.restaurant.id,
      branchId: branchCtx.branch.id,
      accountHolderName: `${ctx.restaurant.name} - ${branchCtx.branch.name}`,
      bankName: bank.name,
      accountNumberMasked: maskedAccountNumber(),
      ifsc: fabricatedIfsc(bank.ifscPrefix),
      isPrimary: false,
      isActive: true,
    });
  }

  return db.bankAccount.createManyAndReturn({ data: rows });
}

/** UpiConfig is `@@unique([branchId])` — exactly one row per branch, never two. */
async function ensureUpiConfigs(db: Db, ctx: SeedContext): Promise<UpiConfig[]> {
  const rows: Prisma.UpiConfigCreateManyInput[] = ctx.branches.map((branchCtx) => ({
    restaurantId: ctx.restaurant.id,
    branchId: branchCtx.branch.id,
    upiId: `dineink.${slugify(branchCtx.branch.name)}@hdfcbank`,
    displayName: `${ctx.restaurant.name} - ${branchCtx.branch.name}`,
    isActive: true,
  }));

  return db.upiConfig.createManyAndReturn({ data: rows });
}

// ─── BankTransactionEntry ───────────────────────────────────────────────

/** Entries created per branch per month — hardcoded here (not config.ts) per the task's scope limit. */
const ENTRIES_PER_BRANCH_MONTH: [number, number] = [15, 25];

// Of each month's entries, this fraction are "real" — built from an actual
// seeded Bill/VendorPayment row and left MATCHED; the remainder are
// plausible-but-generic UNMATCHED entries, demonstrating the reconciliation
// feature's normal in-between state (never 100% matched or 100% unmatched).
const MATCHED_FRACTION = 0.75;
const MATCHED_CREDIT_SHARE = 0.6; // of the matched slice, how much comes from Bills (CREDIT) vs VendorPayments (DEBIT)

const CREDIT_MATCHED_DESCRIPTIONS = ["UPI settlement", "Card settlement", "Bill collection settlement"];
const DEBIT_MATCHED_DESCRIPTION = "Vendor payment settlement";

interface UnmatchedTemplate {
  description: string;
  amountRange: [number, number];
}

const UNMATCHED_CREDIT_TEMPLATES: UnmatchedTemplate[] = [
  { description: "NEFT credit", amountRange: [1000, 20000] },
  { description: "UPI settlement", amountRange: [500, 15000] },
  { description: "Cash deposit", amountRange: [2000, 25000] },
];

const UNMATCHED_DEBIT_TEMPLATES: UnmatchedTemplate[] = [
  { description: "Bank charges", amountRange: [50, 500] },
  { description: "Vendor payment", amountRange: [1000, 10000] },
  { description: "Utility bill payment", amountRange: [500, 6000] },
];

interface BillSample {
  id: number;
  total: number;
  createdAt: Date;
}

interface VendorPaymentSample {
  id: number;
  amount: number;
  paymentDate: Date;
}

async function fetchBillSample(db: Db, restaurantId: number, branch: Branch, month: number, year: number): Promise<BillSample[]> {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);
  return db.bill.findMany({
    where: { restaurantId, branchId: branch.id, status: "PAID", createdAt: { gte: monthStart, lt: monthEnd } },
    select: { id: true, total: true, createdAt: true },
    take: 100,
  });
}

async function fetchVendorPaymentSample(
  db: Db,
  restaurantId: number,
  branch: Branch,
  month: number,
  year: number,
): Promise<VendorPaymentSample[]> {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);
  return db.vendorPayment.findMany({
    where: { restaurantId, branchId: branch.id, paymentDate: { gte: monthStart, lt: monthEnd } },
    select: { id: true, amount: true, paymentDate: true },
    take: 50,
  });
}

function unmatchedEntryRow(
  restaurantId: number,
  branch: Branch,
  bankAccountId: number,
  createdById: number,
  month: number,
  year: number,
): Prisma.BankTransactionEntryCreateManyInput {
  const type = weightedPick({ CREDIT: 0.5, DEBIT: 0.5 });
  const template = pickOne(type === "CREDIT" ? UNMATCHED_CREDIT_TEMPLATES : UNMATCHED_DEBIT_TEMPLATES);
  const entryDate = new Date(year, month - 1, randomInt(1, 28));

  return {
    restaurantId,
    branchId: branch.id,
    bankAccountId,
    entryDate,
    description: template.description,
    amount: randomMoney(template.amountRange[0], template.amountRange[1]),
    type,
    reconciliationStatus: "UNMATCHED",
    matchedBillId: null,
    matchedVendorPaymentId: null,
    createdById,
  };
}

/**
 * Owns: BankAccount, UpiConfig, and BankTransactionEntry. BankTransactionEntry
 * rows are built primarily from real, already-seeded Bill (paid) and
 * VendorPayment rows for the branch/month so most entries genuinely
 * reconcile against something real, with a plausible generic minority left
 * UNMATCHED — this is what makes the reconciliation UI's "match this entry"
 * flow demonstrable with seed data instead of being 0% or 100% matched.
 *
 * Idempotent: checked via a plain count() on BankAccount (the first model
 * this generator owns) — if any already exist for this restaurant, returns
 * the existing rows for all three models instead of duplicating.
 */
export async function generateBankingData(db: Db, config: SeedConfig, ctx: SeedContext): Promise<BankingSeedResult> {
  const existingCount = await db.bankAccount.count({ where: { restaurantId: ctx.restaurant.id } });
  if (existingCount > 0) {
    const [bankAccounts, upiConfigs, bankTransactionEntries] = await Promise.all([
      db.bankAccount.findMany({ where: { restaurantId: ctx.restaurant.id } }),
      db.upiConfig.findMany({ where: { restaurantId: ctx.restaurant.id } }),
      db.bankTransactionEntry.findMany({ where: { restaurantId: ctx.restaurant.id } }),
    ]);
    return { bankAccounts, upiConfigs, bankTransactionEntries };
  }

  const bankAccounts = await ensureBankAccounts(db, ctx);
  const upiConfigs = await ensureUpiConfigs(db, ctx);

  const bankAccountIdByBranchId = new Map(
    bankAccounts.filter((a) => a.branchId !== null).map((a) => [a.branchId as number, a.id]),
  );

  const months = historyMonths(config.history.monthsOfHistory);
  const entryRows: Prisma.BankTransactionEntryCreateManyInput[] = [];

  for (const branchCtx of ctx.branches) {
    const { branch } = branchCtx;
    const bankAccountId = bankAccountIdByBranchId.get(branch.id) ?? bankAccounts[0].id;

    for (const { month, year } of months) {
      const entryCount = randomInt(ENTRIES_PER_BRANCH_MONTH[0], ENTRIES_PER_BRANCH_MONTH[1]);
      const matchedCount = Math.round(entryCount * MATCHED_FRACTION);
      const matchedCreditTarget = Math.round(matchedCount * MATCHED_CREDIT_SHARE);
      const matchedDebitTarget = matchedCount - matchedCreditTarget;

      const [bills, vendorPayments] = await Promise.all([
        fetchBillSample(db, ctx.restaurant.id, branch, month, year),
        fetchVendorPaymentSample(db, ctx.restaurant.id, branch, month, year),
      ]);

      const sampledBills = sampleUnique(bills, Math.min(matchedCreditTarget, bills.length));
      const sampledPayments = sampleUnique(vendorPayments, Math.min(matchedDebitTarget, vendorPayments.length));

      for (const bill of sampledBills) {
        entryRows.push({
          restaurantId: ctx.restaurant.id,
          branchId: branch.id,
          bankAccountId,
          entryDate: addDays(bill.createdAt, randomInt(0, 2)),
          description: pickOne(CREDIT_MATCHED_DESCRIPTIONS),
          amount: bill.total,
          type: "CREDIT",
          reconciliationStatus: "MATCHED",
          matchedBillId: bill.id,
          matchedVendorPaymentId: null,
          createdById: ctx.owner.id,
        });
      }

      for (const payment of sampledPayments) {
        entryRows.push({
          restaurantId: ctx.restaurant.id,
          branchId: branch.id,
          bankAccountId,
          entryDate: addDays(payment.paymentDate, randomInt(0, 2)),
          description: DEBIT_MATCHED_DESCRIPTION,
          amount: payment.amount,
          type: "DEBIT",
          reconciliationStatus: "MATCHED",
          matchedBillId: null,
          matchedVendorPaymentId: payment.id,
          createdById: ctx.owner.id,
        });
      }

      // Whatever the matched samples came up short of the target (small
      // branch/month with few real Bill/VendorPayment rows) is made up with
      // additional plausible UNMATCHED entries, so entryCount is still
      // roughly hit even when real data is sparse.
      const shortfall = matchedCount - sampledBills.length - sampledPayments.length;
      const unmatchedCount = entryCount - matchedCount + Math.max(0, shortfall);

      for (let i = 0; i < unmatchedCount; i++) {
        entryRows.push(unmatchedEntryRow(ctx.restaurant.id, branch, bankAccountId, ctx.owner.id, month, year));
      }
    }
  }

  const bankTransactionEntries = await batchCreateManyAndReturn(entryRows, (chunk) =>
    db.bankTransactionEntry.createManyAndReturn({ data: chunk }),
  );

  return { bankAccounts, upiConfigs, bankTransactionEntries };
}
