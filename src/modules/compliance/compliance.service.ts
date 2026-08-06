import prisma from "../../config/prisma";
import { ForbiddenError } from "./compliance.validation";

// ── Status / due-date helpers ────────────────────────────────────────────────

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Derives the VALID / EXPIRING_SOON / EXPIRED status from whichever of
// nextDueDate/expiryDate a record carries. License-type records (FSSAI,
// FIRE_SAFETY, PEST_CONTROL) generally only populate expiryDate, while
// GST_FILING only populates nextDueDate — either can be present, both are
// checked. If neither date is set there is nothing to be overdue against, so
// default to VALID rather than flagging a record that was never given a date.
export const computeStatus = (nextDueDate: Date | null, expiryDate: Date | null): string => {
  const dates = [nextDueDate, expiryDate].filter((d): d is Date => d instanceof Date);
  if (dates.length === 0) return "VALID";

  const now = Date.now();
  if (dates.some((d) => d.getTime() < now)) return "EXPIRED";

  const soonThreshold = now + THIRTY_DAYS_MS;
  if (dates.some((d) => d.getTime() <= soonThreshold)) return "EXPIRING_SOON";

  return "VALID";
};

// GSTR-3B is due on the 20th of the month following the filing period. Given
// a reference date, this always returns the 20th of the month AFTER the
// reference date's month (at local start-of-day) — that's unambiguous
// regardless of where in the current month the reference date falls, unlike
// "this month's 20th if we're before it" which needs an extra branch.
//
// Exported with a stable name/signature — reused as-is by other modules
// later (Cash Flow Predictor, Dues Tracker) to project the next GST outflow.
export const computeNextGstFilingDueDate = (referenceDate: Date = new Date()): Date => {
  return new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 20, 0, 0, 0, 0);
};

// ── Queries ───────────────────────────────────────────────────────────────────

export const getComplianceRecordsService = async (restaurantId: number, branchId: number) => {
  const records = await prisma.complianceRecord.findMany({
    where: { restaurantId, branchId },
    orderBy: { type: "asc" },
  });

  const now = Date.now();

  // GST_FILING due dates roll forward every month — if the stored
  // nextDueDate is missing or has already passed, project the next one for
  // display purposes only. Persisting that rollover (and recomputing status
  // against it) is a write and belongs to the update/renewal flow, not a
  // read, so this only affects the response, never the DB row.
  return records.map((record) => {
    if (record.type !== "GST_FILING") return record;
    const isStale = !record.nextDueDate || record.nextDueDate.getTime() < now;
    if (!isStale) return record;
    const nextDueDate = computeNextGstFilingDueDate(new Date());
    return {
      ...record,
      nextDueDate,
      status: computeStatus(nextDueDate, record.expiryDate),
    };
  });
};

export const getComplianceSummaryService = async (restaurantId: number, branchId: number) => {
  const records = await prisma.complianceRecord.findMany({
    where: { restaurantId, branchId },
    select: { type: true, nextDueDate: true, expiryDate: true, status: true },
  });

  const summary = { valid: 0, expiringSoon: 0, expired: 0, due: 0, total: records.length };

  records.forEach((record) => {
    // Recompute live rather than trusting the possibly-stale stored status —
    // same reasoning as getComplianceRecordsService: a record's due/expiry
    // date can quietly slide into EXPIRED/EXPIRING_SOON between writes.
    const liveStatus =
      record.type === "GST_FILING" && (!record.nextDueDate || record.nextDueDate.getTime() < Date.now())
        ? computeStatus(computeNextGstFilingDueDate(new Date()), record.expiryDate)
        : computeStatus(record.nextDueDate, record.expiryDate);

    switch (liveStatus) {
      case "EXPIRED":
        summary.expired += 1;
        break;
      case "EXPIRING_SOON":
        summary.expiringSoon += 1;
        break;
      case "DUE":
        summary.due += 1;
        break;
      default:
        summary.valid += 1;
    }
  });

  return summary;
};

// ── Mutations ─────────────────────────────────────────────────────────────────

type ComplianceRecordInput = {
  branchId: number;
  type: string;
  licenseNumber?: string;
  issueDate?: string;
  expiryDate?: string;
  nextDueDate?: string;
  documentUrl?: string;
  notes?: string;
  createdById?: number;
};

export const createComplianceRecordService = async (
  callerRestaurantId: number,
  data: ComplianceRecordInput,
) => {
  const branch = await prisma.branch.findUnique({
    where: { id: data.branchId },
    select: { restaurantId: true },
  });
  if (!branch || branch.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this branch");
  }

  const expiryDate = data.expiryDate ? new Date(data.expiryDate) : null;
  let nextDueDate = data.nextDueDate ? new Date(data.nextDueDate) : null;
  if (data.type === "GST_FILING" && !nextDueDate) {
    nextDueDate = computeNextGstFilingDueDate();
  }

  return prisma.complianceRecord.create({
    data: {
      restaurantId:  callerRestaurantId,
      branchId:      data.branchId,
      type:          data.type,
      licenseNumber: data.licenseNumber,
      issueDate:     data.issueDate ? new Date(data.issueDate) : null,
      expiryDate,
      nextDueDate,
      status:        computeStatus(nextDueDate, expiryDate),
      documentUrl:   data.documentUrl,
      notes:         data.notes,
      createdById:   data.createdById,
    },
  });
};

type ComplianceRecordUpdateInput = Partial<ComplianceRecordInput> & {
  lastRenewedDate?: string;
};

export const updateComplianceRecordService = async (
  callerRestaurantId: number,
  id: number,
  data: ComplianceRecordUpdateInput,
) => {
  const existing = await prisma.complianceRecord.findUnique({ where: { id } });
  if (!existing) throw new Error("Compliance record not found");
  if (existing.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this compliance record");
  }

  const expiryDate =
    data.expiryDate !== undefined ? (data.expiryDate ? new Date(data.expiryDate) : null) : existing.expiryDate;
  let nextDueDate =
    data.nextDueDate !== undefined ? (data.nextDueDate ? new Date(data.nextDueDate) : null) : existing.nextDueDate;

  const type = data.type ?? existing.type;
  const lastRenewedDate = data.lastRenewedDate ? new Date(data.lastRenewedDate) : undefined;

  // A renewal (lastRenewedDate being set) on a GST_FILING record rolls its
  // next due date forward from the renewal date, rather than leaving the
  // now-satisfied due date in place until the next monthly rollover picks
  // it up on read.
  if (lastRenewedDate && type === "GST_FILING") {
    nextDueDate = computeNextGstFilingDueDate(lastRenewedDate);
  }

  const status = computeStatus(nextDueDate, expiryDate);

  return prisma.complianceRecord.update({
    where: { id },
    data: {
      type,
      licenseNumber:   data.licenseNumber !== undefined ? data.licenseNumber : undefined,
      issueDate:       data.issueDate !== undefined ? (data.issueDate ? new Date(data.issueDate) : null) : undefined,
      expiryDate,
      nextDueDate,
      status,
      documentUrl:     data.documentUrl !== undefined ? data.documentUrl : undefined,
      notes:           data.notes !== undefined ? data.notes : undefined,
      lastRenewedDate: lastRenewedDate ?? undefined,
    },
  });
};

export const deleteComplianceRecordService = async (callerRestaurantId: number, id: number) => {
  const existing = await prisma.complianceRecord.findUnique({ where: { id }, select: { restaurantId: true } });
  if (!existing) throw new Error("Compliance record not found");
  if (existing.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this compliance record");
  }
  return prisma.complianceRecord.delete({ where: { id } });
};
