/**
 * Emails must be compared/stored case-insensitively — Postgres text columns
 * are case-sensitive by default, so without this a user who signs up as
 * "John@Example.com" can't log in typing "john@example.com". Every write to
 * User.email/EmailOtp.email/PasswordResetOtp.email, and every lookup by
 * email, must go through this so signup and login always agree.
 */
export const normalizeEmail = <T extends string | null | undefined>(email: T): T =>
  (email == null ? email : (email.trim().toLowerCase() as T));
