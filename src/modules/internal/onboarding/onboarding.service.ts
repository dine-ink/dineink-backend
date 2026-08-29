import prisma from "../../../config/prisma";
import type { Prisma, PrismaClient } from "../../../../generated/prisma";
import { AUDIT_ACTIONS, auditData } from "../audit/audit.service";
import { invalidState, notFound } from "../shared/apiError";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Restaurant onboarding: the checklist a restaurant must clear, and the stages
 * it moves through on the way to going live.
 */

export const ONBOARDING_STAGES = [
  "LEAD",
  "INTERESTED",
  "ONBOARDING",
  "VERIFICATION",
  "CONFIGURATION",
  "TESTING",
  "READY",
  "ACTIVE",
] as const;

export type OnboardingStage = (typeof ONBOARDING_STAGES)[number];

export interface OnboardingTaskTemplate {
  key: string;
  label: string;
  category: string;
  isMandatory: boolean;
}

/**
 * The checklist template.
 *
 * Rows are materialized per restaurant from this list when the record is
 * created, rather than the checklist being read from the template at display
 * time. That way adding a step later doesn't retroactively mark every
 * already-live restaurant as incomplete against a requirement that didn't exist
 * when it was onboarded.
 *
 * Staff training is the one non-mandatory item: it's genuinely valuable but a
 * restaurant should not be blocked from trading over it, and pretending
 * otherwise would mean operations routinely overriding their own gate.
 */
export const ONBOARDING_TEMPLATE: OnboardingTaskTemplate[] = [
  { key: "restaurant_details", label: "Restaurant details captured", category: "Details", isMandatory: true },
  { key: "owner_contact", label: "Owner / contact details verified", category: "Details", isMandatory: true },
  { key: "documents", label: "Required documents collected", category: "Documents", isMandatory: true },
  { key: "agreement", label: "Agreement signed", category: "Documents", isMandatory: true },
  { key: "menu_configured", label: "Menu configured", category: "Configuration", isMandatory: true },
  { key: "tables_configured", label: "Tables configured", category: "Configuration", isMandatory: true },
  { key: "qr_generated", label: "QR codes generated", category: "Configuration", isMandatory: true },
  { key: "users_created", label: "Restaurant users created", category: "Configuration", isMandatory: true },
  { key: "payment_configuration", label: "Payment configuration complete", category: "Configuration", isMandatory: true },
  { key: "testing_completed", label: "Testing completed", category: "Verification", isMandatory: true },
  { key: "staff_training", label: "Staff training delivered", category: "Verification", isMandatory: false },
  { key: "final_verification", label: "Final verification signed off", category: "Verification", isMandatory: true },
];

export const createOnboardingChecklist = (db: Db, restaurantId: number) =>
  db.restaurantOnboardingTask.createMany({
    data: ONBOARDING_TEMPLATE.map((task, index) => ({
      restaurantId,
      key: task.key,
      label: task.label,
      category: task.category,
      isMandatory: task.isMandatory,
      sortOrder: index,
    })),
    skipDuplicates: true,
  });

/**
 * Materializes the checklist for a restaurant that doesn't have one.
 *
 * Every restaurant that existed before the internal console — which is all of
 * them, on any real deployment — has no checklist rows. Without this, their
 * mandatory-step list is empty, which means *zero blockers*, which means the
 * activation gate passes trivially for exactly the restaurants it most needs to
 * check. `skipDuplicates` makes it idempotent, so it's safe to call on any read.
 */
export const ensureChecklist = async (restaurantId: number) => {
  const existing = await prisma.restaurantOnboardingTask.count({ where: { restaurantId } });
  if (existing > 0) return;
  await createOnboardingChecklist(prisma, restaurantId);
};

export const getChecklist = async (restaurantId: number) => {
  await ensureChecklist(restaurantId);

  const tasks = await prisma.restaurantOnboardingTask.findMany({
    where: { restaurantId },
    orderBy: { sortOrder: "asc" },
    include: { completedBy: { select: { id: true, name: true, email: true } } },
  });

  const mandatory = tasks.filter((t) => t.isMandatory);
  const mandatoryComplete = mandatory.filter(
    (t) => t.status === "COMPLETE" || t.status === "NOT_APPLICABLE",
  );
  const allComplete = tasks.filter((t) => t.status === "COMPLETE" || t.status === "NOT_APPLICABLE");

  return {
    tasks,
    summary: {
      total: tasks.length,
      complete: allComplete.length,
      mandatoryTotal: mandatory.length,
      mandatoryComplete: mandatoryComplete.length,
      blockers: mandatory
        .filter((t) => t.status !== "COMPLETE" && t.status !== "NOT_APPLICABLE")
        .map((t) => ({ key: t.key, label: t.label, status: t.status })),
      percentComplete: tasks.length ? Math.round((allComplete.length / tasks.length) * 100) : 0,
    },
  };
};

export const updateTask = async (
  req: any,
  restaurantId: number,
  taskKey: string,
  input: { status: string; notes?: string | null },
) => {
  const task = await prisma.restaurantOnboardingTask.findUnique({
    where: { restaurantId_key: { restaurantId, key: taskKey } },
  });
  if (!task) throw notFound("That onboarding step doesn't exist for this restaurant.", "TASK_NOT_FOUND");

  const validStatuses = ["PENDING", "IN_PROGRESS", "COMPLETE", "BLOCKED", "NOT_APPLICABLE"];
  if (!validStatuses.includes(input.status)) {
    throw invalidState("That isn't a valid step status.", "INVALID_TASK_STATUS");
  }
  if (task.isMandatory && input.status === "NOT_APPLICABLE") {
    throw invalidState(
      `"${task.label}" is a mandatory step and can't be marked not applicable.`,
      "TASK_MANDATORY",
    );
  }

  const isCompleting = input.status === "COMPLETE";

  const [updated] = await prisma.$transaction([
    prisma.restaurantOnboardingTask.update({
      where: { id: task.id },
      data: {
        status: input.status as any,
        notes: input.notes ?? task.notes,
        completedAt: isCompleting ? new Date() : null,
        completedById: isCompleting ? req.internal.id : null,
      },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.ONBOARDING_TASK_UPDATED,
        resourceType: "Restaurant",
        resourceId: restaurantId,
        resourceLabel: task.label,
        previousValue: { status: task.status, notes: task.notes },
        newValue: { status: input.status, notes: input.notes ?? task.notes },
      }),
    }),
  ]);

  return updated;
};

/**
 * Stage transitions.
 *
 * Forward movement is one stage at a time — skipping from ONBOARDING straight
 * to READY would bypass exactly the checks the stages exist to represent.
 * Moving backwards is allowed (a verification can genuinely fail) but requires
 * a reason, which lands in the audit log.
 *
 * ACTIVE is not reachable here. Going live runs through
 * `activateRestaurant`, which additionally enforces the mandatory checklist.
 */
export const assertStageTransition = (from: OnboardingStage, to: OnboardingStage, reason?: string | null) => {
  if (from === to) {
    throw invalidState(`This restaurant is already at the ${to} stage.`, "STAGE_UNCHANGED");
  }
  if (to === "ACTIVE") {
    throw invalidState(
      "Use the Activate action to take a restaurant live — it checks the mandatory onboarding steps first.",
      "USE_ACTIVATE_ACTION",
    );
  }
  const fromIndex = ONBOARDING_STAGES.indexOf(from);
  const toIndex = ONBOARDING_STAGES.indexOf(to);
  if (fromIndex === -1 || toIndex === -1) {
    throw invalidState("That isn't a valid onboarding stage.", "INVALID_STAGE");
  }
  if (toIndex > fromIndex + 1) {
    throw invalidState(
      `Onboarding moves one stage at a time. The next stage after ${from} is ${ONBOARDING_STAGES[fromIndex + 1]}.`,
      "STAGE_SKIP_NOT_ALLOWED",
    );
  }
  if (toIndex < fromIndex && !reason?.trim()) {
    throw invalidState(
      "Moving a restaurant back a stage needs a reason.",
      "REASON_REQUIRED",
    );
  }
};

export const setStage = async (
  req: any,
  restaurantId: number,
  to: OnboardingStage,
  reason?: string | null,
) => {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, name: true, onboardingStage: true, platformStatus: true },
  });
  if (!restaurant) throw notFound("Restaurant not found", "RESTAURANT_NOT_FOUND");

  assertStageTransition(restaurant.onboardingStage as OnboardingStage, to, reason);

  const [updated] = await prisma.$transaction([
    prisma.restaurant.update({
      where: { id: restaurantId },
      data: {
        onboardingStage: to as any,
        // A restaurant that has started moving through onboarding shouldn't
        // still be reported as a LEAD on the platform status.
        platformStatus:
          restaurant.platformStatus === "LEAD" && to !== "LEAD" ? ("ONBOARDING" as any) : undefined,
      },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.RESTAURANT_STAGE_CHANGED,
        resourceType: "Restaurant",
        resourceId: restaurantId,
        resourceLabel: restaurant.name,
        previousValue: { onboardingStage: restaurant.onboardingStage },
        newValue: { onboardingStage: to },
        reason: reason ?? null,
      }),
    }),
  ]);

  return updated;
};
