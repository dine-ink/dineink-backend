import crypto from "crypto";
import bcrypt from "bcryptjs";
import prisma from "../../../config/prisma";
import { createStaffService, updateStaffService } from "../../restaurant/restaurant.service";
import { AUDIT_ACTIONS, auditData, pick } from "../audit/audit.service";
import { invalidState, notFound } from "../shared/apiError";

/**
 * A restaurant's own staff accounts, managed from the internal console.
 *
 * The create/update paths call straight into the restaurant module's existing
 * `createStaffService` / `updateStaffService` rather than reimplementing them.
 * Those functions already encode the rules that matter — a staff member's
 * branch must belong to their restaurant, a login-enabled account needs a real
 * password, emails are normalized — and the internal app must not end up with a
 * second, subtly different version of them.
 *
 * What this layer adds is the part those functions can't do for themselves: the
 * restaurantId they take on trust is, here, one an employee has been explicitly
 * authorized to act on, and every change lands in the audit log.
 */

export const RESTAURANT_ROLES = ["OWNER", "MANAGER", "STAFF", "CASHIER"] as const;

export const listRestaurantUsers = async (restaurantId: number, branchId?: number) => {
  const users = await prisma.user.findMany({
    where: { restaurantId, isDeleted: false, ...(branchId ? { branchId } : {}) },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      hasLogin: true,
      department: true,
      shift: true,
      joiningDate: true,
      createdAt: true,
      branch: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // `User` has no lastLoginAt column — the restaurant apps never recorded one.
  // Returning null (rather than omitting the field or inventing a value) keeps
  // the column in the UI honest: it renders "Never recorded", not a date.
  return users.map((user) => ({ ...user, lastLoginAt: null as Date | null }));
};

const assertRole = (role: string | undefined) => {
  if (role && !(RESTAURANT_ROLES as readonly string[]).includes(role)) {
    throw invalidState(
      `"${role}" isn't a valid restaurant role. Use one of: ${RESTAURANT_ROLES.join(", ")}.`,
      "INVALID_ROLE",
    );
  }
};

export const createRestaurantUser = async (req: any, restaurantId: number, input: any) => {
  assertRole(input.role);
  if (!input.name?.trim()) throw invalidState("Enter the staff member's name.", "NAME_REQUIRED");

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, name: true },
  });
  if (!restaurant) throw notFound("Restaurant not found", "RESTAURANT_NOT_FOUND");

  const created = await createStaffService(restaurantId, input);

  await prisma.internalAuditLog.create({
    data: auditData(req, {
      action: AUDIT_ACTIONS.RESTAURANT_USER_CREATED,
      resourceType: "RestaurantUser",
      resourceId: created.id,
      resourceLabel: `${created.name} @ ${restaurant.name}`,
      // Never the password, hashed or otherwise.
      newValue: pick(created, ["name", "email", "phone", "role", "hasLogin", "branchId"]),
    }),
  });

  return created;
};

export const updateRestaurantUser = async (
  req: any,
  restaurantId: number,
  userId: number,
  input: any,
) => {
  assertRole(input.role);

  const before = await prisma.user.findUnique({ where: { id: userId } });
  if (!before || before.restaurantId !== restaurantId || before.isDeleted) {
    throw notFound("That staff member doesn't belong to this restaurant.", "USER_NOT_FOUND");
  }

  const updated = await updateStaffService(restaurantId, userId, input);

  await prisma.internalAuditLog.create({
    data: auditData(req, {
      action: AUDIT_ACTIONS.RESTAURANT_USER_UPDATED,
      resourceType: "RestaurantUser",
      resourceId: userId,
      resourceLabel: updated.name,
      previousValue: pick(before, ["name", "email", "phone", "role", "hasLogin", "branchId", "isActive"]),
      newValue: pick(updated, ["name", "email", "phone", "role", "hasLogin", "branchId", "isActive"]),
      reason: input.reason ?? null,
    }),
  });

  return updated;
};

export const setRestaurantUserActive = async (
  req: any,
  restaurantId: number,
  userId: number,
  isActive: boolean,
  reason?: string,
) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.restaurantId !== restaurantId || user.isDeleted) {
    throw notFound("That staff member doesn't belong to this restaurant.", "USER_NOT_FOUND");
  }
  if (user.isActive === isActive) {
    throw invalidState(
      `${user.name} is already ${isActive ? "active" : "disabled"}.`,
      "NO_CHANGES",
    );
  }
  if (!isActive && user.role === "OWNER") {
    // Disabling the owner would lock the restaurant out of its own account, and
    // an operations employee is not the right person to make that call
    // unilaterally.
    throw invalidState(
      "The restaurant owner's account can't be disabled from here. Suspend the restaurant instead if it needs to stop trading.",
      "CANNOT_DISABLE_OWNER",
    );
  }
  if (!isActive && !reason?.trim()) {
    throw invalidState("Disabling a staff account needs a reason.", "REASON_REQUIRED");
  }

  const [updated] = await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { isActive } }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.RESTAURANT_USER_DISABLED,
        resourceType: "RestaurantUser",
        resourceId: userId,
        resourceLabel: user.name,
        previousValue: { isActive: user.isActive },
        newValue: { isActive },
        reason: reason ?? null,
      }),
    }),
  ]);

  return updated;
};

/**
 * Resets a staff member's access.
 *
 * Generates a temporary password and returns it exactly once, to be read out to
 * the restaurant. It is not emailed from here: a restaurant staff account often
 * has no verified email address on file (`User.email` is nullable and many are
 * created phone-only), so a "we've emailed them" flow would silently do nothing
 * for a large share of accounts.
 */
export const resetRestaurantUserAccess = async (
  req: any,
  restaurantId: number,
  userId: number,
  reason?: string,
) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.restaurantId !== restaurantId || user.isDeleted) {
    throw notFound("That staff member doesn't belong to this restaurant.", "USER_NOT_FOUND");
  }
  if (!reason?.trim()) {
    throw invalidState("Resetting someone's access needs a reason.", "REASON_REQUIRED");
  }

  const temporaryPassword = `${crypto.randomBytes(6).toString("base64url")}1`;

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { password: await bcrypt.hash(temporaryPassword, 10), hasLogin: true },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.RESTAURANT_USER_ACCESS_RESET,
        resourceType: "RestaurantUser",
        resourceId: userId,
        resourceLabel: user.name,
        reason: reason.trim(),
      }),
    }),
  ]);

  return { temporaryPassword };
};
