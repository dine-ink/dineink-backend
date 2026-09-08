import prisma from "../../config/prisma";
import { tooManyRequests } from "../../shared/apiError";

/**
 * Per-account brute-force protection for restaurant sign-in.
 *
 * `authRateLimiter` bounds how fast one IP address can guess. It does nothing
 * about the attack that actually matters here: a distributed attempt against
 * one known owner's account, which is worth mounting because that account can
 * read the restaurant's sales, payroll and bank details. This is the
 * per-account half of that pair.
 *
 * Twenty failures inside an hour and the password stops being a way in at all.
 * Not for an hour — at all, until the person proves they control the mailbox on
 * the account and sets a new password. That is stricter than the internal
 * console's timed unlock, and deliberately so: an account that has just absorbed
 * twenty wrong passwords is either under attack or already compromised enough
 * that someone is close, and a timed unlock hands the attacker another twenty
 * guesses every hour, indefinitely.
 *
 * The known cost, stated rather than hidden: anyone who knows an owner's email
 * address can force that owner through a password reset by failing twenty
 * times. That is a nuisance — the owner can always recover, because recovery
 * needs their mailbox and not their password — but it is a real one. It is the
 * accepted trade for closing an unbounded online guessing attack, and it is why
 * the counter is scoped per account rather than per address: a single attacker
 * cannot lock out every account in a restaurant with one script.
 */

export const MAX_FAILED_ATTEMPTS = 20;
export const FAILURE_WINDOW_MINUTES = 60;

/**
 * The instant failures start counting from.
 *
 * The later of "an hour ago" and "when the password was last changed". The
 * second term is what stops a successful reset from being undone by the same
 * twenty attempts that forced it: without it the user sets a new password,
 * signs in, and is immediately locked again by history.
 */
export const failureWindowStart = (now: Date, passwordChangedAt: Date | null | undefined): Date => {
  const windowOpens = new Date(now.getTime() - FAILURE_WINDOW_MINUTES * 60 * 1000);
  if (passwordChangedAt && passwordChangedAt > windowOpens) return passwordChangedAt;
  return windowOpens;
};

/** The 20th failure is the one that locks, so the test is `>=`. */
export const shouldLock = (failureCount: number): boolean => failureCount >= MAX_FAILED_ATTEMPTS;

/** How many guesses are left before the lock trips. Never negative. */
export const attemptsRemaining = (failureCount: number): number =>
  Math.max(0, MAX_FAILED_ATTEMPTS - failureCount);

export interface AttemptContext {
  ip?: string;
  userAgent?: string;
}

/**
 * Records one rejected sign-in. Fire-and-forget on the write failing: an
 * attempt we could not log must not turn a wrong password into a 500, which
 * would tell an attacker something a wrong password does not.
 */
export const recordFailedAttempt = (
  identifier: string,
  userId: number | null,
  reason: string,
  context: AttemptContext,
) =>
  prisma.loginAttempt
    .create({
      data: {
        userId,
        identifier: identifier.slice(0, 254),
        ip: context.ip ?? null,
        userAgent: context.userAgent?.slice(0, 512) ?? null,
        reason,
      },
    })
    .catch(() => undefined);

export const countRecentFailures = (userId: number, since: Date) =>
  prisma.loginAttempt.count({ where: { userId, createdAt: { gte: since } } });

/**
 * The error shown to an account that is already latched.
 *
 * It names the remedy, because the alternative — a generic "invalid
 * credentials" — leaves a locked-out owner retrying forever with a password
 * that is actually correct. This does confirm the address belongs to an
 * account, but `POST /auth/forgot-password` already answers that question
 * directly ("No account found with this email"), so nothing new is disclosed.
 */
export const lockedError = () =>
  tooManyRequests(
    "Too many failed sign-in attempts. For your security this account is locked — " +
      "reset your password using the code we email you, then sign in again.",
    "ACCOUNT_LOCKED",
  );

/**
 * Called after a password comparison fails. Records the attempt, then latches
 * the account if the failure count inside the window has reached the limit.
 *
 * Returns whether this failure was the one that locked it, so the caller can
 * tell the person what just happened instead of leaving them to discover it on
 * the next try.
 */
export const registerFailure = async (
  user: { id: number; passwordChangedAt: Date | null },
  identifier: string,
  context: AttemptContext,
): Promise<{ locked: boolean; remaining: number }> => {
  const now = new Date();
  await recordFailedAttempt(identifier, user.id, "BAD_PASSWORD", context);

  const failures = await countRecentFailures(user.id, failureWindowStart(now, user.passwordChangedAt));

  if (!shouldLock(failures)) {
    return { locked: false, remaining: attemptsRemaining(failures) };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { mustResetPassword: true, passwordLockedAt: now },
  });
  return { locked: true, remaining: 0 };
};

/**
 * Lifts the latch. Called only from the two paths that have actually proven
 * something: an email-verified reset, and a signed-in password change.
 *
 * `passwordChangedAt` moves to now in the same write, which is what makes the
 * old failures stop counting — see `failureWindowStart`.
 */
export const clearLockout = (userId: number) =>
  prisma.user.update({
    where: { id: userId },
    data: { mustResetPassword: false, passwordLockedAt: null, passwordChangedAt: new Date() },
  });
