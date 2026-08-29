/**
 * One-time backfill: mark pre-existing accounts as live.
 *
 * `platformStatus` is a new column, so every restaurant that existed before the
 * internal console got the old ONBOARDING default — including accounts that
 * have been trading for a year. Onboarding means "we are still talking to them
 * and no account exists yet", so a restaurant with an owner account is by
 * definition past it.
 *
 * Deliberately NOT run through activateRestaurant(): that gate exists to stop
 * someone taking a *new* restaurant live before its checklist is done, and
 * these restaurants were live long before the checklist existed. Faking twelve
 * completed steps to satisfy a gate would put a lie in the audit trail. Instead
 * each row is updated with an audit record that says plainly what happened.
 *
 *   npx tsx scripts/backfill-restaurant-status.ts            # dry run
 *   npx tsx scripts/backfill-restaurant-status.ts --apply
 */
import prisma from "../src/config/prisma";
import { AUDIT_ACTIONS } from "../src/modules/internal/audit/audit.service";

const apply = process.argv.includes("--apply");

const main = async () => {
  // Having an owner account is the signal that an account was created for them.
  const candidates = await prisma.restaurant.findMany({
    where: { platformStatus: "ONBOARDING", ownerId: { not: null } },
    select: {
      id: true, name: true, platformStatus: true, onboardingStage: true, createdAt: true,
      owner: { select: { email: true } },
      _count: { select: { bills: true, users: true, branches: true } },
    },
    orderBy: { id: "asc" },
  });

  const skipped = await prisma.restaurant.count({
    where: { platformStatus: "ONBOARDING", ownerId: null },
  });

  console.log(`${apply ? "APPLYING" : "DRY RUN"} — ${candidates.length} account(s) to mark live\n`);
  for (const r of candidates) {
    console.log(`  RES-${r.id}  ${r.name}`);
    console.log(`      owner ${r.owner?.email}  ·  ${r._count.branches} outlet(s)  ·  ${r._count.bills} bills  ·  ${r._count.users} users`);
    console.log(`      ${r.platformStatus}/${r.onboardingStage}  ->  ACTIVE/ACTIVE`);
  }
  console.log(`\n  left alone (no owner account, so genuinely not onboarded): ${skipped}`);

  if (!apply) {
    console.log("\n  Nothing written. Re-run with --apply to commit.");
    return;
  }

  for (const r of candidates) {
    await prisma.$transaction([
      prisma.restaurant.update({
        where: { id: r.id },
        data: {
          platformStatus: "ACTIVE",
          onboardingStage: "ACTIVE",
          // The account existed from the day it was created; that is the
          // honest "live since" date, not the day this backfill ran.
          activatedAt: r.createdAt,
        },
      }),
      prisma.internalAuditLog.create({
        data: {
          actorId: null,
          actorEmail: null,
          actorName: "System (backfill)",
          action: AUDIT_ACTIONS.RESTAURANT_ACTIVATED,
          resourceType: "Restaurant",
          resourceId: String(r.id),
          resourceLabel: r.name,
          previousValue: { platformStatus: r.platformStatus, onboardingStage: r.onboardingStage },
          newValue: { platformStatus: "ACTIVE", onboardingStage: "ACTIVE", activatedAt: r.createdAt },
          reason:
            "One-time backfill. platformStatus is a new column and defaulted to ONBOARDING for every " +
            "pre-existing restaurant. This account has an owner account and so was never onboarding.",
        },
      }),
    ]);
    console.log(`  ✓ RES-${r.id} marked live`);
  }
};

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
