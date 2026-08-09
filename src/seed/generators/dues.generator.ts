import { addDays, subDays } from "date-fns";
import type { MonthlyDue, Prisma } from "../../../generated/prisma";
import type { SeedConfig } from "../config";
import type { SeedContext } from "../context";
import { batchCreateManyAndReturn, type Db, historyMonths, randomFloat, randomInt, randomMoney, weightedPick } from "../utils";

const CATEGORIES = ["EB", "SALARIES", "RENT", "OPERATIONS", "UTILITIES", "MAINTENANCE", "MISC", "EMI"] as const;
type DueCategory = (typeof CATEGORIES)[number];

// Plausible average monthly salary (INR) per staff member for a demo
// restaurant — SALARIES is derived from branch headcount rather than exact
// payroll data, which this generator doesn't have access to.
const AVG_STAFF_MONTHLY_SALARY = 18000;

/** Per-category monthly amountDue range (INR), except SALARIES which is derived from staff headcount instead. */
const AMOUNT_RANGE: Record<Exclude<DueCategory, "SALARIES">, [number, number]> = {
  EB: [15000, 45000],
  RENT: [40000, 120000],
  OPERATIONS: [8000, 30000],
  UTILITIES: [5000, 15000],
  MAINTENANCE: [3000, 20000],
  MISC: [2000, 10000],
  // EMI has no EmiSchedule cross-reference available to this generator (out
  // of scope per task) — a plausible independent range is used instead.
  EMI: [10000, 60000],
};

function amountDueFor(category: DueCategory, staffCount: number): number {
  if (category === "SALARIES") {
    return Math.round(staffCount * AVG_STAFF_MONTHLY_SALARY * randomFloat(0.9, 1.1) * 100) / 100;
  }
  const [min, max] = AMOUNT_RANGE[category];
  return randomMoney(min, max);
}

function buildOlderMonthRow(
  ctx: SeedContext,
  branchId: number,
  category: DueCategory,
  month: number,
  year: number,
  staffCount: number,
): Prisma.MonthlyDueCreateManyInput {
  const amountDue = amountDueFor(category, staffCount);
  const dueDate = new Date(year, month - 1, randomInt(5, 10));
  const paidDate = addDays(dueDate, randomInt(1, 7));

  return {
    restaurantId: ctx.restaurant.id,
    branchId,
    category,
    month,
    year,
    amountDue,
    amountPaid: amountDue,
    dueDate,
    paidDate,
    status: "PAID",
    notes: null,
    createdById: ctx.owner.id,
  };
}

function buildCurrentMonthRow(
  ctx: SeedContext,
  branchId: number,
  category: DueCategory,
  month: number,
  year: number,
  staffCount: number,
  now: Date,
): Prisma.MonthlyDueCreateManyInput {
  const amountDue = amountDueFor(category, staffCount);
  let dueDate = new Date(year, month - 1, randomInt(5, 10));

  // Mix of PENDING / PARTIAL / OVERDUE for the most recent month so the
  // demo doesn't show every category in the same state at once.
  const status = weightedPick({ PENDING: 0.45, PARTIAL: 0.35, OVERDUE: 0.2 });

  if (status === "OVERDUE" && dueDate.getTime() >= now.getTime()) {
    // OVERDUE requires a dueDate that has actually already passed.
    dueDate = subDays(now, randomInt(1, 5));
  }

  const amountPaid = status === "PARTIAL" ? Math.round(amountDue * randomFloat(0.4, 0.8) * 100) / 100 : 0;
  const paidDate = status === "PARTIAL" ? addDays(dueDate, randomInt(1, Math.max(1, Math.floor((now.getTime() - dueDate.getTime()) / 86400000)))) : null;

  return {
    restaurantId: ctx.restaurant.id,
    branchId,
    category,
    month,
    year,
    amountDue,
    amountPaid,
    dueDate,
    paidDate,
    status,
    notes: null,
    createdById: ctx.owner.id,
  };
}

function buildMonthlyDues(config: SeedConfig, ctx: SeedContext): Prisma.MonthlyDueCreateManyInput[] {
  const now = new Date();
  const months = historyMonths(config.history.monthsOfHistory);
  const lastMonthIndex = months.length - 1;
  const rows: Prisma.MonthlyDueCreateManyInput[] = [];

  for (const branchCtx of ctx.branches) {
    const staffCount = branchCtx.staff.length;

    months.forEach(({ month, year }, index) => {
      for (const category of CATEGORIES) {
        rows.push(
          index === lastMonthIndex
            ? buildCurrentMonthRow(ctx, branchCtx.branch.id, category, month, year, staffCount, now)
            : buildOlderMonthRow(ctx, branchCtx.branch.id, category, month, year, staffCount),
        );
      }
    });
  }

  return rows;
}

/**
 * Owns: MonthlyDue — one row per branch, per category (EB, SALARIES, RENT,
 * OPERATIONS, UTILITIES, MAINTENANCE, MISC, EMI), per month across
 * historyMonths(config.history.monthsOfHistory). SALARIES is derived from
 * each branch's own staff headcount (ctx.branches[i].staff.length) rather
 * than exact payroll, since this generator has no payroll source to
 * cross-reference. EMI similarly uses an independent plausible range — it
 * doesn't cross-reference EmiSchedule data, which is out of scope here.
 *
 * All months except the most recent are fully PAID (amountPaid ==
 * amountDue, paidDate a few days after dueDate) for a clean historical
 * paper trail. The most recent month mixes PENDING / PARTIAL / OVERDUE
 * across categories so the demo shows realistic variety in what's still
 * outstanding.
 *
 * Idempotent: generates once per restaurant, checked via a plain count().
 */
export async function generateMonthlyDues(db: Db, config: SeedConfig, ctx: SeedContext): Promise<MonthlyDue[]> {
  const existingCount = await db.monthlyDue.count({ where: { restaurantId: ctx.restaurant.id } });
  if (existingCount > 0) {
    return db.monthlyDue.findMany({ where: { restaurantId: ctx.restaurant.id } });
  }

  return batchCreateManyAndReturn(buildMonthlyDues(config, ctx), (chunk) => db.monthlyDue.createManyAndReturn({ data: chunk }));
}
