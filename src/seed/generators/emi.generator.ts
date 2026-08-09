import type { EmiSchedule, Prisma } from "../../../generated/prisma";
import type { SeedConfig } from "../config";
import type { SeedContext } from "../context";
import { type Db, chance, pickOne, randomFloat, randomInt, randomMoney, sampleUnique, subDays } from "../utils";

/**
 * Loan/EMI names that make sense restaurant-wide (shared equipment/software
 * that isn't tied to a single branch's kitchen) vs. names that read
 * naturally suffixed with a branch name (kitchen hardware financed per
 * location). Kept as plain templates rather than a weighted pool since we
 * only ever draw a handful (4-6) of these per restaurant.
 */
const RESTAURANT_WIDE_EMI_NAMES = [
  "POS Terminal EMI",
  "Delivery Bike Fleet EMI",
  "Central Billing Software Loan",
  "Refrigeration Upgrade EMI",
  "Kitchen Exhaust System Loan",
];

const PER_BRANCH_EMI_TEMPLATES = [
  "Walk-in Freezer EMI",
  "Renovation Loan",
  "AC Installation EMI",
  "Dining Furniture EMI",
  "Kitchen Equipment Loan",
];

const LENDER_NAMES = ["HDFC Bank", "ICICI Bank", "Bajaj Finserv", "Axis Bank", "IDFC FIRST Bank", "Tata Capital"];

interface EmiCandidate {
  name: string;
  branchId: number | null;
}

/**
 * Owns: EmiSchedule — a handful (4-6) of realistic restaurant loans/EMIs, a
 * mix of restaurant-wide (branchId null, e.g. a POS/delivery-fleet loan
 * shared across locations) and per-branch (e.g. a branch's walk-in freezer
 * or renovation loan). equipment.generator.ts (run right after this) links
 * ~25-30% of Equipment rows back to whichever of these schedules is
 * plausible for that equipment's branch.
 *
 * emiAmount is a simple-interest approximation (principal / tenure * a
 * small markup), not a real amortization schedule — good enough for demo
 * data, not meant to reconcile to the paisa.
 *
 * Idempotent: generates once per restaurant, checked via a plain count().
 */
export async function generateEmiSchedules(db: Db, config: SeedConfig, ctx: SeedContext): Promise<EmiSchedule[]> {
  const existingCount = await db.emiSchedule.count({ where: { restaurantId: ctx.restaurant.id } });
  if (existingCount > 0) {
    return db.emiSchedule.findMany({ where: { restaurantId: ctx.restaurant.id } });
  }

  const totalCount = randomInt(4, 6);
  const restaurantWideCount = randomInt(1, Math.min(2, totalCount - 1));
  const perBranchCount = totalCount - restaurantWideCount;

  const restaurantWideCandidates: EmiCandidate[] = sampleUnique(RESTAURANT_WIDE_EMI_NAMES, restaurantWideCount).map(
    (name) => ({ name, branchId: null }),
  );

  const perBranchPool = ctx.branches.flatMap((branchCtx) =>
    PER_BRANCH_EMI_TEMPLATES.map((template) => ({
      name: `${template} — ${branchCtx.branch.name}`,
      branchId: branchCtx.branch.id,
    })),
  );
  const perBranchCandidates: EmiCandidate[] = sampleUnique(perBranchPool, perBranchCount);

  const candidates = [...restaurantWideCandidates, ...perBranchCandidates];

  const rows: Prisma.EmiScheduleCreateManyInput[] = candidates.map((candidate) => {
    const principalAmount = randomMoney(50_000, 800_000);
    const tenureMonths = randomInt(12, 48);
    // Simple-interest approximation of an EMI, not a real amortization
    // schedule — plausible relative to principal/tenure, nothing more.
    const interestFactor = randomFloat(1.05, 1.12, 3);
    const emiAmount = Math.round((principalAmount / tenureMonths) * interestFactor * 100) / 100;
    // config.history.monthsOfHistory is only 3 months (the bill/inventory
    // window) — EMIs realistically start further back than that, so we use
    // a wider, hardcoded 6-36 month lookback here instead of reusing that
    // config value, since adding a new config key is out of scope for this
    // change.
    const startDate = subDays(new Date(), randomInt(30, 36 * 30));

    return {
      restaurantId: ctx.restaurant.id,
      branchId: candidate.branchId,
      name: candidate.name,
      principalAmount,
      emiAmount,
      dueDayOfMonth: randomInt(1, 28),
      startDate,
      tenureMonths,
      notes: chance(0.5) ? `Financed via ${pickOne(LENDER_NAMES)} — EMI auto-debited monthly.` : null,
      isActive: true,
      createdById: ctx.owner.id,
    };
  });

  return db.emiSchedule.createManyAndReturn({ data: rows });
}
