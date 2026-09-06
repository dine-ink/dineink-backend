import { z, requiredEmail } from "../../shared/validate";

/**
 * Request shapes for every credential endpoint.
 *
 * This file existed but was empty, so `POST /auth/login` reached the service
 * with whatever JSON was sent: `identifier` could be an object, `password`
 * could be absent, and `bcrypt.compare(undefined, hash)` is the kind of thing
 * that throws inside a library rather than returning a clean 400. Validating at
 * the route means a malformed credential request is refused before it touches
 * the database or the hashing cost.
 */

/**
 * The minimum an existing account's password had to satisfy, kept as-is.
 *
 * The internal console requires ten characters and three character classes.
 * Raising this one to match is a product decision with a migration attached
 * (every existing owner would have to be walked through a change), so it is
 * called out rather than changed here — with the new per-account lockout, six
 * characters are no longer exposed to unbounded online guessing.
 */
export const MIN_PASSWORD_LENGTH = 6;

const passwordField = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  // bcrypt silently truncates beyond 72 bytes; refusing is honest, and it also
  // caps the work an unauthenticated caller can ask the server to do.
  .max(72, "Password must be 72 characters or fewer.");

/** An existing password being checked, not set — no policy, just bounds. */
const passwordInput = z.string().min(1, "Enter your password.").max(72);

const otpField = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code from your email.");

const nameField = z.string().trim().min(1, "Enter your name.").max(120);

/**
 * Email *or* phone, so this cannot be `requiredEmail`. Trimmed and bounded;
 * `normalizeEmail` in the service lowercases it, which is a no-op for digits.
 */
const identifierField = z
  .string()
  .trim()
  .min(1, "Enter your email or phone number.")
  .max(254);

const phoneInput = z
  .string()
  .trim()
  .max(32)
  .optional()
  .transform((value) => (value ? value : undefined));

export const loginSchema = z.object({
  identifier: identifierField,
  password: passwordInput,
});

export const signupSchema = z.object({
  name: nameField,
  email: requiredEmail,
  phone: phoneInput,
  password: passwordField,
});

export const sendSignupOtpSchema = z.object({
  email: requiredEmail,
});

export const verifySignupOtpSchema = z.object({
  name: nameField,
  email: requiredEmail,
  phone: phoneInput,
  password: passwordField,
  otp: otpField,
});

export const forgotPasswordSchema = z.object({
  email: requiredEmail,
});

export const resetPasswordSchema = z.object({
  email: requiredEmail,
  otp: otpField,
  newPassword: passwordField,
});

export const changePasswordSchema = z.object({
  currentPassword: passwordInput,
  newPassword: passwordField,
});

export const managerOverrideSchema = z.object({
  password: passwordInput,
});
