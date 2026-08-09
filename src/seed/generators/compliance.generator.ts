import { addDays, subDays, subMonths } from "date-fns";
import type { ComplianceRecord, Prisma } from "../../../generated/prisma";
import type { SeedConfig } from "../config";
import type { SeedContext } from "../context";
import { batchCreateManyAndReturn, chance, type Db, faker, pickOne, randomInt } from "../utils";

// Compliance-record types this generator mints one of, per branch. GST_FILING
// is handled separately below (no license/expiry — it's a nextDueDate row).
const LICENSED_TYPES = ["FSSAI", "FIRE_SAFETY", "PEST_CONTROL"] as const;

const NOTES_BY_TYPE: Record<string, string[]> = {
  FSSAI: [
    "Renewal application submitted to FSSAI portal.",
    "Awaiting inspection before renewal is approved.",
    "Renewed after annual hygiene audit.",
  ],
  FIRE_SAFETY: [
    "Fire extinguishers serviced and NOC re-verified.",
    "Pending fire department re-inspection.",
    "Annual fire safety audit completed.",
  ],
  PEST_CONTROL: [
    "Quarterly pest control service completed.",
    "Follow-up treatment scheduled with vendor.",
    "Renewed after routine kitchen inspection.",
  ],
  GST_FILING: [
    "GSTR-3B filing due for the period.",
    "Filed by accountant, awaiting acknowledgement.",
    "Late fee applicable if not filed promptly.",
  ],
};

/** Realistic-looking license number per compliance type. GST_FILING has none — it's a recurring filing, not a license. */
function licenseNumberFor(type: (typeof LICENSED_TYPES)[number]): string {
  switch (type) {
    case "FSSAI":
      // FSSAI license/registration numbers are 14-digit numeric.
      return faker.string.numeric(14);
    case "FIRE_SAFETY":
      return `FS/${faker.date.past({ years: 2 }).getFullYear()}/${faker.string.numeric(4)}`;
    case "PEST_CONTROL":
      return `PC/${faker.date.past({ years: 2 }).getFullYear()}/${faker.string.numeric(4)}`;
  }
}

/** VALID / EXPIRING_SOON / EXPIRED status consistent with a given expiryDate relative to `now`. */
function statusForExpiry(expiryDate: Date, now: Date): "VALID" | "EXPIRING_SOON" | "EXPIRED" {
  if (expiryDate.getTime() < now.getTime()) return "EXPIRED";
  const daysUntilExpiry = (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (daysUntilExpiry <= 30) return "EXPIRING_SOON";
  return "VALID";
}

function buildLicensedRecord(
  ctx: SeedContext,
  branchId: number,
  type: (typeof LICENSED_TYPES)[number],
  now: Date,
  bucket: number,
): Prisma.ComplianceRecordCreateManyInput {
  // Spread the 3 licensed types across branches into 4 realistic buckets:
  // 0 = already expired, 1 = expiring within 30 days, 2/3 = comfortably valid.
  const issueDate = subMonths(now, randomInt(6, 24));
  let expiryDate: Date;
  switch (bucket % 4) {
    case 0:
      expiryDate = subDays(now, randomInt(1, 60));
      break;
    case 1:
      expiryDate = addDays(now, randomInt(1, 30));
      break;
    default:
      expiryDate = addDays(now, randomInt(60, 540));
      break;
  }
  const status = statusForExpiry(expiryDate, now);
  // Anything not on its very first cycle (i.e. issued more than a year before
  // its expiry window suggests a renewal already happened) gets a lastRenewedDate.
  const isRenewal = chance(0.6);
  const lastRenewedDate = isRenewal ? subMonths(issueDate, -randomInt(1, 3)) : null;

  return {
    restaurantId: ctx.restaurant.id,
    branchId,
    type,
    licenseNumber: licenseNumberFor(type),
    issueDate,
    expiryDate,
    nextDueDate: expiryDate,
    status,
    documentUrl: null,
    lastRenewedDate,
    notes: chance(0.5) ? pickOne(NOTES_BY_TYPE[type]) : null,
    createdById: ctx.owner.id,
  };
}

function buildGstFilingRecord(ctx: SeedContext, branchId: number, now: Date, bucket: number): Prisma.ComplianceRecordCreateManyInput {
  // GST filings are due the 20th of a nearby month — mix overdue/due-soon/upcoming.
  let nextDueDate: Date;
  switch (bucket % 3) {
    case 0:
      nextDueDate = subDays(now, randomInt(1, 10)); // overdue
      break;
    case 1:
      nextDueDate = addDays(now, randomInt(5, 15)); // upcoming
      break;
    default:
      nextDueDate = addDays(now, randomInt(20, 40)); // further out, comfortably valid
      break;
  }
  const daysFromNow = Math.abs((nextDueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const status = daysFromNow <= 10 ? "DUE" : nextDueDate.getTime() < now.getTime() ? "EXPIRED" : "VALID";

  return {
    restaurantId: ctx.restaurant.id,
    branchId,
    type: "GST_FILING",
    licenseNumber: null,
    issueDate: null,
    expiryDate: null,
    nextDueDate,
    status,
    documentUrl: null,
    lastRenewedDate: null,
    notes: chance(0.5) ? pickOne(NOTES_BY_TYPE.GST_FILING) : null,
    createdById: ctx.owner.id,
  };
}

function buildComplianceRecords(ctx: SeedContext): Prisma.ComplianceRecordCreateManyInput[] {
  const now = new Date();
  const rows: Prisma.ComplianceRecordCreateManyInput[] = [];

  ctx.branches.forEach((branchCtx, branchIndex) => {
    LICENSED_TYPES.forEach((type, typeIndex) => {
      rows.push(buildLicensedRecord(ctx, branchCtx.branch.id, type, now, branchIndex * LICENSED_TYPES.length + typeIndex));
    });
    rows.push(buildGstFilingRecord(ctx, branchCtx.branch.id, now, branchIndex));
  });

  return rows;
}

/**
 * Owns: ComplianceRecord — exactly 4 rows per branch, one per type (FSSAI,
 * FIRE_SAFETY, PEST_CONTROL, GST_FILING). The 3 licensed types get an
 * issueDate/expiryDate pair spread across expired / expiring-soon / valid
 * buckets for demo realism; GST_FILING instead gets a recurring
 * nextDueDate (the 20th-of-month filing deadline) with no license/expiry
 * fields. documentUrl is always null — no real uploaded files exist in seed
 * data.
 *
 * Idempotent: generates once per restaurant, checked via a plain count().
 */
export async function generateComplianceRecords(db: Db, config: SeedConfig, ctx: SeedContext): Promise<ComplianceRecord[]> {
  const existingCount = await db.complianceRecord.count({ where: { restaurantId: ctx.restaurant.id } });
  if (existingCount > 0) {
    return db.complianceRecord.findMany({ where: { restaurantId: ctx.restaurant.id } });
  }

  return batchCreateManyAndReturn(buildComplianceRecords(ctx), (chunk) => db.complianceRecord.createManyAndReturn({ data: chunk }));
}
