import bcrypt from "bcryptjs";
import prisma from "../../config/prisma";
import { generateToken } from "../../utils/generateToken/generateToken";
import { sendOtpEmail, sendPasswordResetOtpEmail } from "../../config/mailer";
import { normalizeEmail } from "../../utils/email";
import {
  AttemptContext,
  clearLockout,
  lockedError,
  recordFailedAttempt,
  registerFailure,
} from "./auth.lockout";

const OTP_TTL_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A large manual discount at checkout needs a manager's say-so — mirrors how
// refunds/voids are already manager-only, but a discount is entered by
// whichever cashier is at the register, not necessarily a manager, so this
// checks a manager's password without swapping the cashier's own session
// (no new token is issued). Any MANAGER/OWNER in the same restaurant can
// unlock it — this is a shared-till override, not a personal login.
export const verifyManagerOverride = async (restaurantId: number, password: string) => {
  const approvers = await prisma.user.findMany({
    where: {
      restaurantId,
      role: { in: ["MANAGER", "OWNER"] },
      isActive: true,
      isDeleted: false,
    },
    select: { id: true, name: true, password: true },
  });

  for (const approver of approvers) {
    if (await bcrypt.compare(password, approver.password)) {
      return { approverId: approver.id, approverName: approver.name };
    }
  }
  throw new Error("Incorrect manager password");
};

export const loginUser = async (
  identifier: string,
  password: string,
  context: AttemptContext = {},
) => {
  // identifier may be an email or a phone number — normalizing is a no-op
  // for digits, and makes email matching case-insensitive (a user who
  // signed up as "John@Example.com" must be able to log in as
  // "john@example.com").
  const normalizedIdentifier = normalizeEmail(identifier);
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        {
          email: normalizedIdentifier,
        },
        {
          phone: normalizedIdentifier,
        },
      ],
    },

    include: {
      restaurant: true,
      branch: true,
    },
  });

  // USER NOT FOUND

  if (!user) {
    // Recorded with a null userId. Probing for which addresses exist is the
    // reconnaissance step before password guessing, and it should be visible
    // in the same place.
    await recordFailedAttempt(normalizedIdentifier ?? "", null, "NO_SUCH_ACCOUNT", context);
    throw new Error("Invalid credentials");
  }

  // USER DELETED / INACTIVE

  if (user.isDeleted || !user.isActive) {
    throw new Error("Account is inactive");
  }

  // LOCKOUT CHECK
  //
  // Before the password comparison, not after: once the account is latched the
  // password is not a way in even when it is correct, so comparing it would
  // burn a bcrypt round to reach the same answer.

  if (user.mustResetPassword) {
    await recordFailedAttempt(normalizedIdentifier ?? "", user.id, "LOCKED", context);
    throw lockedError();
  }

  // LOGIN ACCESS CHECK

  if (user.role !== "OWNER" && !user.hasLogin) {
    throw new Error("Login access denied");
  }

  // PASSWORD CHECK

  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    const { locked } = await registerFailure(user, normalizedIdentifier ?? "", context);
    if (locked) throw lockedError();
    throw new Error("Invalid credentials");
  }

  // TOKEN

  const token = generateToken({
    id: user.id,
    email: user.email,
    role: user.role,
    restaurantId: user.restaurantId,
    branchId: user.branchId,
  });

  // REMOVE PASSWORD

  const { password: _, ...safeUser } = user;

  // BRANCHES

  const branches = user.restaurantId
    ? await prisma.branch.findMany({
        where: {
          restaurantId: user.restaurantId,
          isDeleted: false,
          isActive: true,
        },

        orderBy: {
          createdAt: "asc",
        },
      })
    : [];

  return {
    token,
    user: safeUser,
    restaurant: safeUser.restaurant,
    branches,
  };
};

const createOwnerAccount = async ({
  name,
  email,
  phone,
  password,
}: {
  name: string;
  email: string;
  phone?: string;
  password: string;
}) => {
  email = normalizeEmail(email);
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        {
          email,
        },
        {
          phone,
        },
      ],
    },
  });

  if (existingUser) {
    throw new Error("User already exists");
  }
  if (password.length < 6) {
    throw new Error("Password must be at least 6 characters");
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  let user;
  try {
    user = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        password: hashedPassword,
        role: "OWNER",
      },
    });
  } catch (error: any) {
    if (error.code === "P2002") {
      throw new Error("User with this email or phone already exists");
    }
    throw error;
  }

  const token = generateToken({
    id: user.id,
    email: user.email,
    role: user.role,
    restaurantId: user.restaurantId,
    branchId: user.branchId,
  });
  const { password: _, ...safeUser } = user;
  return {
    token,
    user: safeUser,
  };
};

// Kept for any existing internal/back-compat callers — creates the account
// directly with no email verification step.
export const signupUser = createOwnerAccount;

export const sendSignupOtp = async (email: string) => {
  email = normalizeEmail(email);
  if (!email || !EMAIL_REGEX.test(email)) {
    throw new Error("Enter a valid email address");
  }

  const existingUser = await prisma.user.findFirst({ where: { email } });
  if (existingUser) {
    throw new Error("An account with this email already exists");
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await prisma.emailOtp.upsert({
    where: { email },
    update: { otpHash, attempts: 0, expiresAt },
    create: { email, otpHash, expiresAt },
  });

  await sendOtpEmail(email, otp);

  return true;
};

export const verifySignupOtpAndCreateUser = async ({
  name,
  email,
  phone,
  password,
  otp,
}: {
  name: string;
  email: string;
  phone?: string;
  password: string;
  otp: string;
}) => {
  email = normalizeEmail(email);
  const record = await prisma.emailOtp.findUnique({ where: { email } });

  if (!record) {
    throw new Error(
      "No verification code found for this email — request a new one",
    );
  }
  if (record.expiresAt < new Date()) {
    await prisma.emailOtp.delete({ where: { email } });
    throw new Error("Verification code expired — request a new one");
  }
  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    await prisma.emailOtp.delete({ where: { email } });
    throw new Error("Too many incorrect attempts — request a new code");
  }

  const isValid = await bcrypt.compare(otp || "", record.otpHash);
  if (!isValid) {
    await prisma.emailOtp.update({
      where: { email },
      data: { attempts: { increment: 1 } },
    });
    throw new Error("Incorrect verification code");
  }

  // Single-use: consume the OTP before creating the account.
  await prisma.emailOtp.delete({ where: { email } });

  return createOwnerAccount({ name, email, phone, password });
};

export const changePasswordService = async (
  userId: number,
  currentPassword: string,
  newPassword: string,
) => {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }
  const isValid = await bcrypt.compare(currentPassword, user.password);
  if (!isValid) {
    throw new Error("Current password is incorrect");
  }
  if (newPassword.length < 6) {
    throw new Error("Password must be at least 6 characters");
  }
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      password: hashedPassword,
    },
  });
  // A signed-in change also resets the failure window: the caller held a valid
  // session and knew the current password, so any failures behind them are
  // stale.
  await clearLockout(userId);
  return true;
};

export const sendPasswordResetOtp = async (email: string) => {
  email = normalizeEmail(email);
  if (!email || !EMAIL_REGEX.test(email)) {
    throw new Error("Enter a valid email address");
  }

  const user = await prisma.user.findFirst({ where: { email } });
  if (!user || user.isDeleted) {
    throw new Error("No account found with this email");
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await prisma.passwordResetOtp.upsert({
    where: { email },
    update: { otpHash, attempts: 0, expiresAt },
    create: { email, otpHash, expiresAt },
  });

  await sendPasswordResetOtpEmail(email, otp);

  return true;
};

export const verifyPasswordResetOtpAndSetPassword = async ({
  email,
  otp,
  newPassword,
}: {
  email: string;
  otp: string;
  newPassword: string;
}) => {
  email = normalizeEmail(email);
  const record = await prisma.passwordResetOtp.findUnique({ where: { email } });

  if (!record) {
    throw new Error(
      "No verification code found for this email — request a new one",
    );
  }
  if (record.expiresAt < new Date()) {
    await prisma.passwordResetOtp.delete({ where: { email } });
    throw new Error("Verification code expired — request a new one");
  }
  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    await prisma.passwordResetOtp.delete({ where: { email } });
    throw new Error("Too many incorrect attempts — request a new code");
  }

  const isValid = await bcrypt.compare(otp || "", record.otpHash);
  if (!isValid) {
    await prisma.passwordResetOtp.update({
      where: { email },
      data: { attempts: { increment: 1 } },
    });
    throw new Error("Incorrect verification code");
  }

  if (!newPassword || newPassword.length < 6) {
    throw new Error("Password must be at least 6 characters");
  }

  const user = await prisma.user.findFirst({ where: { email } });
  if (!user) {
    await prisma.passwordResetOtp.delete({ where: { email } });
    throw new Error("No account found with this email");
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashedPassword },
  });

  // This is the one path that proves control of the mailbox, so it is the one
  // path that lifts a brute-force lock. Moving passwordChangedAt to now is what
  // stops the failures that caused the lock from immediately re-triggering it.
  await clearLockout(user.id);

  // Single-use: consume the OTP once the password has been changed.
  await prisma.passwordResetOtp.delete({ where: { email } });

  return true;
};
