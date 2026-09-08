// The staff-related checks setupRestaurantService runs before it opens its
// transaction, as pure functions over already-fetched data so they can be
// unit-tested without Prisma.
//
// Why these exist: User.email and User.phone are unique across the whole
// table. Before this, a staff member entered with the owner's own phone, or
// two staff sharing an email, surfaced as a Prisma P2002 that the controller
// turned into "A user with this phone already exists" — true, but it did not
// say which of the staff rows, or that the clash was with the owner's own
// account. Every error here names the row the way the setup modal labels it
// ("Staff 2 ("Ravi")") and the field by its on-screen label.

import { normalizeEmail } from "../../utils/email";
import { ApiError, badRequest } from "../../shared/apiError";

export const MIN_STAFF_PASSWORD_LENGTH = 6;

export interface SetupStaffMember {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  hasLogin?: boolean;
  password?: string | null;
  [key: string]: unknown;
}

export interface ExistingContact {
  id: number;
  email: string | null;
  phone: string | null;
}

export interface StaffContactProblem {
  index: number;
  field: "email" | "phone" | "password";
  message: string;
}

const isBlank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

const staffLabel = (s: SetupStaffMember, i: number) =>
  isBlank(s.name) ? `Staff ${i + 1}` : `Staff ${i + 1} ("${String(s.name).trim()}")`;

const fieldLabel = { email: "email address", phone: "phone number" } as const;

/**
 * Trims and lower-cases emails, trims phones, and turns blanks into null so a
 * missing contact is stored as NULL (which the unique index ignores) rather
 * than "" (which it does not — two staff without an email would collide).
 */
export const normalizeStaffContacts = <T extends SetupStaffMember>(staff: T[]): T[] =>
  staff.map((s) => ({
    ...s,
    email: isBlank(s.email) ? null : normalizeEmail(String(s.email)),
    phone: isBlank(s.phone) ? null : String(s.phone).trim(),
  }));

/** A staff member with login access needs a real password, not the placeholder. */
export const assertStaffPasswords = (staff: SetupStaffMember[]): void => {
  staff.forEach((s, i) => {
    if (s.hasLogin && (s.password ?? "").length < MIN_STAFF_PASSWORD_LENGTH) {
      throw badRequest(
        `${staffLabel(s, i)} has Login Access on but no password of at least ${MIN_STAFF_PASSWORD_LENGTH} characters.`,
        "STAFF_PASSWORD_TOO_SHORT",
        [{ index: i, field: "password" }],
      );
    }
  });
};

/** Two rows in the same setup sharing an email or a phone. */
export const findDuplicateStaffContacts = (staff: SetupStaffMember[]): StaffContactProblem[] => {
  const problems: StaffContactProblem[] = [];
  for (const field of ["email", "phone"] as const) {
    const seen = new Map<string, number>();
    staff.forEach((s, i) => {
      const value = s[field];
      if (isBlank(value)) return;
      const prev = seen.get(String(value));
      if (prev === undefined) {
        seen.set(String(value), i);
        return;
      }
      problems.push({
        index: i,
        field,
        message: `${staffLabel(staff[prev], prev)} and ${staffLabel(s, i)} have the same ${fieldLabel[field]}.`,
      });
    });
  }
  return problems;
};

/**
 * Rows whose email or phone already belongs to a user — the owner's own
 * account is called out separately, since that is the common mistake.
 */
export const findExistingStaffContacts = (
  staff: SetupStaffMember[],
  existing: ExistingContact[],
  ownerId: number,
): StaffContactProblem[] => {
  const problems: StaffContactProblem[] = [];
  for (const field of ["email", "phone"] as const) {
    const byValue = new Map(existing.filter((u) => u[field]).map((u) => [u[field] as string, u]));
    staff.forEach((s, i) => {
      const value = s[field];
      if (isBlank(value)) return;
      const match = byValue.get(String(value));
      if (!match) return;
      problems.push({
        index: i,
        field,
        message:
          match.id === ownerId
            ? `${staffLabel(s, i)} uses your own account's ${fieldLabel[field]}; staff need their own.`
            : `${staffLabel(s, i)}: the ${fieldLabel[field]} ${value} is already registered to another account.`,
      });
    });
  }
  return problems;
};

/** Throws a 409 naming every clashing row, or returns when all contacts are free. */
export const assertStaffContactsAvailable = (
  staff: SetupStaffMember[],
  existing: ExistingContact[],
  ownerId: number,
): void => {
  const problems = [
    ...findDuplicateStaffContacts(staff),
    ...findExistingStaffContacts(staff, existing, ownerId),
  ];
  if (problems.length === 0) return;
  // conflict() takes no details; the per-row list is what lets the modal
  // land on the right step, so build the error directly.
  throw new ApiError(
    409,
    "DUPLICATE_STAFF_CONTACT",
    `Staff Setup: ${problems.map((p) => p.message).join(" ")}`,
    problems,
  );
};

/** The distinct non-blank emails and phones to look up before the transaction. */
export const collectStaffContacts = (staff: SetupStaffMember[]) => ({
  emails: Array.from(new Set(staff.map((s) => s.email).filter((v): v is string => !isBlank(v)))),
  phones: Array.from(new Set(staff.map((s) => s.phone).filter((v): v is string => !isBlank(v)))),
});
