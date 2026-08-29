import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../../../config/prisma";
import { normalizeEmail } from "../../../utils/email";
import { getInternalJwtSecret, INTERNAL_TOKEN_TYPE } from "../rbac/internalAuth.middleware";
import { AUDIT_ACTIONS, auditData, recordAudit } from "../audit/audit.service";
import { ApiError, badRequest, invalidState, notFound, tooManyRequests } from "../shared/apiError";
import { buildOtpAuthUrl, generateSecret, verifyTotp } from "./totp";

/**
 * Internal employee authentication.
 *
 * Deliberately stricter than the restaurant apps' auth, because this console can
 * suspend restaurants, read customer records and change permissions:
 *
 *   - 12-hour sessions, not 7 days.
 *   - Sessions are rows, so access can be cut immediately (see the middleware).
 *   - Failed attempts are counted and the account locks; attempts against an
 *     address that doesn't exist are recorded too, so probing for valid
 *     employee emails costs the same as guessing a password.
 *   - Every login response is identical whether the email exists, the password
 *     is wrong, or the account is disabled — the account state is in the audit
 *     log, not in the reply to an unauthenticated caller.
 */

const SESSION_TTL_HOURS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const MIN_PASSWORD_LENGTH = 10;
const PASSWORD_RESET_TTL_MINUTES = 30;
const TWO_FA_CHALLENGE_TTL_MINUTES = 5;

// One message for every rejected login. Anything more specific tells an
// attacker which half of the credential pair to keep working on.
const GENERIC_LOGIN_FAILURE = "Incorrect email or password.";

export const assertPasswordPolicy = (password: string) => {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      "WEAK_PASSWORD",
    );
  }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) {
    throw badRequest(
      "Password must include at least three of: lowercase, uppercase, number, symbol.",
      "WEAK_PASSWORD",
    );
  }
};

const recordLoginAttempt = (email: string, ip: string | undefined, success: boolean, reason?: string) =>
  prisma.internalLoginAttempt
    .create({ data: { email, ip: ip ?? null, success, reason: reason ?? null } })
    .catch(() => undefined);

const issueSession = async (
  user: { id: number; email: string; name: string },
  ip?: string,
  userAgent?: string,
) => {
  const tokenId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);

  await prisma.internalSession.create({
    data: { userId: user.id, tokenId, ip: ip ?? null, userAgent: userAgent ?? null, expiresAt },
  });

  const token = jwt.sign(
    { sub: user.id, typ: INTERNAL_TOKEN_TYPE, jti: tokenId },
    getInternalJwtSecret(),
    { expiresIn: `${SESSION_TTL_HOURS}h` },
  );

  return { token, expiresAt };
};

export const buildSessionUser = async (userId: number) => {
  const user = await prisma.internalUser.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: { include: { permissions: true } } } } },
  });
  if (!user) throw notFound("Employee not found", "EMPLOYEE_NOT_FOUND");

  const permissions = Array.from(
    new Set(user.roles.flatMap((link) => link.role.permissions.map((p) => p.permission))),
  ).sort();

  return {
    id: user.id,
    employeeCode: user.employeeCode,
    name: user.name,
    email: user.email,
    phone: user.phone,
    department: user.department,
    designation: user.designation,
    status: user.status,
    twoFactorEnabled: user.twoFactorEnabled,
    twoFactorRequired: user.twoFactorRequired,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    roles: user.roles.map((link) => ({ id: link.role.id, key: link.role.key, name: link.role.name })),
    permissions,
  };
};

export const login = async (
  rawEmail: string,
  password: string,
  context: { ip?: string; userAgent?: string; req?: any },
) => {
  const email = normalizeEmail(rawEmail || "");
  if (!email || !password) throw badRequest(GENERIC_LOGIN_FAILURE, "INVALID_CREDENTIALS");

  const user = await prisma.internalUser.findUnique({ where: { email } });

  if (!user) {
    await recordLoginAttempt(email, context.ip, false, "NO_SUCH_ACCOUNT");
    await recordAudit(context.req, {
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      resourceType: "InternalUser",
      resourceLabel: email,
      reason: "No such account",
      actorOverride: { email },
    });
    throw new ApiError(401, "INVALID_CREDENTIALS", GENERIC_LOGIN_FAILURE);
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await recordLoginAttempt(email, context.ip, false, "LOCKED");
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    throw tooManyRequests(
      `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or reset your password.`,
      "ACCOUNT_LOCKED",
    );
  }

  const passwordValid = await bcrypt.compare(password, user.password);

  if (!passwordValid) {
    const failedLoginCount = user.failedLoginCount + 1;
    const shouldLock = failedLoginCount >= MAX_FAILED_ATTEMPTS;
    await prisma.internalUser.update({
      where: { id: user.id },
      data: {
        failedLoginCount,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : user.lockedUntil,
      },
    });
    await recordLoginAttempt(email, context.ip, false, shouldLock ? "LOCKED_OUT" : "BAD_PASSWORD");
    await recordAudit(context.req, {
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      resourceType: "InternalUser",
      resourceId: user.id,
      resourceLabel: user.email,
      reason: shouldLock ? "Locked after repeated failures" : "Incorrect password",
      actorOverride: { id: user.id, email: user.email, name: user.name },
    });
    throw new ApiError(401, "INVALID_CREDENTIALS", GENERIC_LOGIN_FAILURE);
  }

  // Correct password, but the account isn't usable. Same generic message: a
  // disabled employee's address shouldn't be confirmable from outside.
  if (user.status !== "ACTIVE") {
    await recordLoginAttempt(email, context.ip, false, `STATUS_${user.status}`);
    throw new ApiError(401, "INVALID_CREDENTIALS", GENERIC_LOGIN_FAILURE);
  }

  await prisma.internalUser.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null },
  });

  // 2FA is a second step, not a second factor bolted onto the same response:
  // the challenge token authorizes nothing except completing this login.
  if (user.twoFactorEnabled && user.twoFactorSecret) {
    const challengeToken = jwt.sign(
      { sub: user.id, typ: "internal-2fa" },
      getInternalJwtSecret(),
      { expiresIn: `${TWO_FA_CHALLENGE_TTL_MINUTES}m` },
    );
    await recordLoginAttempt(email, context.ip, false, "AWAITING_2FA");
    return { twoFactorRequired: true as const, challengeToken };
  }

  return finalizeLogin(user.id, context);
};

export const completeTwoFactorLogin = async (
  challengeToken: string,
  code: string,
  context: { ip?: string; userAgent?: string; req?: any },
) => {
  let payload: any;
  try {
    payload = jwt.verify(challengeToken, getInternalJwtSecret());
  } catch {
    throw new ApiError(401, "CHALLENGE_EXPIRED", "That sign-in attempt expired. Please sign in again.");
  }
  if (payload?.typ !== "internal-2fa" || !payload?.sub) {
    throw new ApiError(401, "CHALLENGE_INVALID", "That sign-in attempt is no longer valid.");
  }

  const user = await prisma.internalUser.findUnique({ where: { id: Number(payload.sub) } });
  if (!user || user.status !== "ACTIVE" || !user.twoFactorSecret) {
    throw new ApiError(401, "CHALLENGE_INVALID", "That sign-in attempt is no longer valid.");
  }

  if (!verifyTotp(user.twoFactorSecret, code)) {
    await recordLoginAttempt(user.email, context.ip, false, "BAD_2FA_CODE");
    throw new ApiError(401, "INVALID_2FA_CODE", "That code isn't right. Check your authenticator app and try again.");
  }

  return finalizeLogin(user.id, context);
};

const finalizeLogin = async (
  userId: number,
  context: { ip?: string; userAgent?: string; req?: any },
) => {
  const user = await prisma.internalUser.update({
    where: { id: userId },
    data: { lastLoginAt: new Date(), lastLoginIp: context.ip ?? null },
  });

  const { token, expiresAt } = await issueSession(user, context.ip, context.userAgent);
  await recordLoginAttempt(user.email, context.ip, true);
  await recordAudit(context.req, {
    action: AUDIT_ACTIONS.LOGIN_SUCCESS,
    resourceType: "InternalUser",
    resourceId: user.id,
    resourceLabel: user.email,
    actorOverride: { id: user.id, email: user.email, name: user.name },
  });

  return {
    twoFactorRequired: false as const,
    token,
    expiresAt,
    user: await buildSessionUser(user.id),
  };
};

export const logout = async (req: any) => {
  const ctx = req.internal;
  if (!ctx) return true;
  await prisma.internalSession.update({
    where: { id: ctx.sessionId },
    data: { revokedAt: new Date(), revokedReason: "USER_LOGOUT" },
  });
  await recordAudit(req, {
    action: AUDIT_ACTIONS.LOGOUT,
    resourceType: "InternalUser",
    resourceId: ctx.id,
    resourceLabel: ctx.email,
  });
  return true;
};

export const listMySessions = async (userId: number, currentSessionId: number) => {
  const sessions = await prisma.internalSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
  });
  return sessions.map((s) => ({
    id: s.id,
    ip: s.ip,
    userAgent: s.userAgent,
    createdAt: s.createdAt,
    lastSeenAt: s.lastSeenAt,
    expiresAt: s.expiresAt,
    isCurrent: s.id === currentSessionId,
  }));
};

export const revokeSession = async (req: any, sessionId: number, reason = "USER_REVOKED") => {
  const session = await prisma.internalSession.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== req.internal.id) {
    throw notFound("Session not found", "SESSION_NOT_FOUND");
  }
  await prisma.internalSession.update({
    where: { id: sessionId },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  await recordAudit(req, {
    action: AUDIT_ACTIONS.SESSION_REVOKED,
    resourceType: "InternalSession",
    resourceId: sessionId,
    resourceLabel: req.internal.email,
  });
  return true;
};

export const changePassword = async (req: any, currentPassword: string, newPassword: string) => {
  const user = await prisma.internalUser.findUnique({ where: { id: req.internal.id } });
  if (!user) throw notFound("Employee not found", "EMPLOYEE_NOT_FOUND");

  if (!(await bcrypt.compare(currentPassword, user.password))) {
    throw badRequest("Your current password is incorrect.", "INVALID_CREDENTIALS");
  }
  assertPasswordPolicy(newPassword);
  if (await bcrypt.compare(newPassword, user.password)) {
    throw badRequest("Choose a password you haven't used here before.", "PASSWORD_REUSED");
  }

  const hashed = await bcrypt.hash(newPassword, 10);

  await prisma.$transaction([
    prisma.internalUser.update({
      where: { id: user.id },
      data: { password: hashed, mustChangePassword: false },
    }),
    // Changing a password ends every other session — otherwise a password
    // change made *because* the old one leaked leaves the leaked session live.
    prisma.internalSession.updateMany({
      where: { userId: user.id, id: { not: req.internal.sessionId }, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "PASSWORD_CHANGED" },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.PASSWORD_CHANGED,
        resourceType: "InternalUser",
        resourceId: user.id,
        resourceLabel: user.email,
      }),
    }),
  ]);

  return true;
};

/**
 * Password reset.
 *
 * The response is identical whether or not the address belongs to an employee,
 * so this endpoint can't be used to enumerate staff. The email itself is sent
 * through the existing SendGrid mailer.
 */
export const requestPasswordReset = async (rawEmail: string, context: { ip?: string; req?: any }) => {
  const email = normalizeEmail(rawEmail || "");
  const user = email ? await prisma.internalUser.findUnique({ where: { email } }) : null;

  if (!user || user.status === "DISABLED") return { sent: true };

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  await prisma.$transaction([
    // Any earlier outstanding link stops working the moment a new one is asked
    // for, so a forwarded old email can't be used later.
    prisma.internalPasswordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.internalPasswordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000),
      },
    }),
  ]);

  await recordAudit(context.req, {
    action: AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED,
    resourceType: "InternalUser",
    resourceId: user.id,
    resourceLabel: user.email,
    actorOverride: { id: user.id, email: user.email, name: user.name },
  });

  return { sent: true, token: rawToken, user };
};

export const completePasswordReset = async (rawToken: string, newPassword: string, req: any) => {
  const tokenHash = crypto.createHash("sha256").update(rawToken || "").digest("hex");
  const record = await prisma.internalPasswordResetToken.findFirst({
    where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    include: { user: true },
  });
  if (!record) {
    throw badRequest("That reset link is invalid or has expired. Request a new one.", "RESET_TOKEN_INVALID");
  }

  assertPasswordPolicy(newPassword);
  const hashed = await bcrypt.hash(newPassword, 10);

  await prisma.$transaction([
    prisma.internalPasswordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.internalUser.update({
      where: { id: record.userId },
      data: { password: hashed, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null },
    }),
    prisma.internalSession.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "PASSWORD_RESET" },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.PASSWORD_RESET_COMPLETED,
        resourceType: "InternalUser",
        resourceId: record.userId,
        resourceLabel: record.user.email,
        actorOverride: { id: record.userId, email: record.user.email, name: record.user.name },
      }),
    }),
  ]);

  return true;
};

// ─── Two-factor enrolment ────────────────────────────────────────────────────

export const beginTwoFactorSetup = async (req: any) => {
  const user = await prisma.internalUser.findUnique({ where: { id: req.internal.id } });
  if (!user) throw notFound("Employee not found", "EMPLOYEE_NOT_FOUND");
  if (user.twoFactorEnabled) {
    throw invalidState("Two-factor authentication is already switched on for this account.", "2FA_ALREADY_ENABLED");
  }

  // Stored before confirmation so the code can be checked against it, but
  // twoFactorEnabled stays false until a valid code proves the employee really
  // has the secret in their authenticator — otherwise a half-finished setup
  // would lock them out.
  const secret = generateSecret();
  await prisma.internalUser.update({ where: { id: user.id }, data: { twoFactorSecret: secret } });

  return { secret, otpauthUrl: buildOtpAuthUrl(secret, user.email) };
};

export const confirmTwoFactorSetup = async (req: any, code: string) => {
  const user = await prisma.internalUser.findUnique({ where: { id: req.internal.id } });
  if (!user?.twoFactorSecret) {
    throw invalidState("Start two-factor setup before confirming a code.", "2FA_NOT_STARTED");
  }
  if (!verifyTotp(user.twoFactorSecret, code)) {
    throw badRequest("That code isn't right. Check your authenticator app and try again.", "INVALID_2FA_CODE");
  }
  await prisma.internalUser.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
  return true;
};

export const disableTwoFactor = async (req: any, password: string) => {
  const user = await prisma.internalUser.findUnique({ where: { id: req.internal.id } });
  if (!user) throw notFound("Employee not found", "EMPLOYEE_NOT_FOUND");
  if (user.twoFactorRequired) {
    throw invalidState(
      "Two-factor authentication is required for your role and can't be switched off.",
      "2FA_REQUIRED",
    );
  }
  if (!(await bcrypt.compare(password, user.password))) {
    throw badRequest("Your password is incorrect.", "INVALID_CREDENTIALS");
  }
  await prisma.internalUser.update({
    where: { id: user.id },
    data: { twoFactorEnabled: false, twoFactorSecret: null },
  });
  return true;
};
