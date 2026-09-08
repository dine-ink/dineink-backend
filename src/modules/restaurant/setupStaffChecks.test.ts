import { describe, expect, it } from "vitest";
import { ApiError } from "../../shared/apiError";
import {
  assertStaffContactsAvailable,
  assertStaffPasswords,
  collectStaffContacts,
  findDuplicateStaffContacts,
  findExistingStaffContacts,
  normalizeStaffContacts,
} from "./setupStaffChecks";

const OWNER_ID = 7;

const caught = (fn: () => void): ApiError => {
  try {
    fn();
  } catch (e) {
    return e as ApiError;
  }
  throw new Error("expected a throw");
};

describe("normalizeStaffContacts", () => {
  it("lower-cases and trims emails, trims phones, and stores blanks as null", () => {
    expect(
      normalizeStaffContacts([
        { name: "Ravi", email: "  Ravi@Example.COM ", phone: " 9123456780 " },
        { name: "Anu", email: "", phone: "   " },
        { name: "Kumar" },
      ]),
    ).toEqual([
      { name: "Ravi", email: "ravi@example.com", phone: "9123456780" },
      { name: "Anu", email: null, phone: null },
      { name: "Kumar", email: null, phone: null },
    ]);
  });
});

describe("assertStaffPasswords", () => {
  it("passes roster-only staff with no password", () => {
    expect(() => assertStaffPasswords([{ name: "Ravi", hasLogin: false, password: "" }])).not.toThrow();
  });

  it("names the row when Login Access is on without a usable password", () => {
    const err = caught(() =>
      assertStaffPasswords([
        { name: "Ravi", hasLogin: true, password: "secret1" },
        { name: "Anu", hasLogin: true, password: "1234" },
      ]),
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("STAFF_PASSWORD_TOO_SHORT");
    expect(err.message).toBe(
      'Staff 2 ("Anu") has Login Access on but no password of at least 6 characters.',
    );
    expect(err.details).toEqual([{ index: 1, field: "password" }]);
  });
});

describe("findDuplicateStaffContacts", () => {
  it("reports each pair sharing an email or phone, by row", () => {
    const problems = findDuplicateStaffContacts([
      { name: "Ravi", email: "ravi@example.com", phone: "9123456780" },
      { name: "", email: null, phone: "9123456780" },
      { name: "Kumar", email: "ravi@example.com", phone: "9123456782" },
    ]);
    expect(problems).toEqual([
      { index: 2, field: "email", message: 'Staff 1 ("Ravi") and Staff 3 ("Kumar") have the same email address.' },
      { index: 1, field: "phone", message: 'Staff 1 ("Ravi") and Staff 2 have the same phone number.' },
    ]);
  });

  it("ignores blanks", () => {
    expect(
      findDuplicateStaffContacts([
        { name: "A", email: null, phone: null },
        { name: "B", email: null, phone: null },
      ]),
    ).toEqual([]);
  });
});

describe("findExistingStaffContacts", () => {
  const existing = [
    { id: OWNER_ID, email: "owner@example.com", phone: "9876543210" },
    { id: 42, email: "someone@else.com", phone: "9000000000" },
  ];

  it("says when a row reuses the owner's own contact", () => {
    expect(
      findExistingStaffContacts(
        [{ name: "Ravi", email: "owner@example.com", phone: "9876543210" }],
        existing,
        OWNER_ID,
      ),
    ).toEqual([
      { index: 0, field: "email", message: 'Staff 1 ("Ravi") uses your own account\'s email address; staff need their own.' },
      { index: 0, field: "phone", message: 'Staff 1 ("Ravi") uses your own account\'s phone number; staff need their own.' },
    ]);
  });

  it("says when a row's contact belongs to some other account", () => {
    expect(
      findExistingStaffContacts(
        [
          { name: "Ravi", email: "ravi@example.com", phone: "9123456780" },
          { name: "Anu", email: null, phone: "9000000000" },
        ],
        existing,
        OWNER_ID,
      ),
    ).toEqual([
      {
        index: 1,
        field: "phone",
        message: 'Staff 2 ("Anu"): the phone number 9000000000 is already registered to another account.',
      },
    ]);
  });
});

describe("assertStaffContactsAvailable", () => {
  it("returns when every contact is free", () => {
    expect(() =>
      assertStaffContactsAvailable([{ name: "Ravi", email: null, phone: "9123456780" }], [], OWNER_ID),
    ).not.toThrow();
  });

  it("throws a 409 listing every clash, prefixed with the step name", () => {
    const err = caught(() =>
      assertStaffContactsAvailable(
        [
          { name: "Ravi", email: null, phone: "9876543210" },
          { name: "Anu", email: null, phone: "9876543210" },
        ],
        [{ id: OWNER_ID, email: "owner@example.com", phone: "9876543210" }],
        OWNER_ID,
      ),
    );
    expect(err.status).toBe(409);
    expect(err.code).toBe("DUPLICATE_STAFF_CONTACT");
    expect(err.message).toBe(
      'Staff Setup: Staff 1 ("Ravi") and Staff 2 ("Anu") have the same phone number. ' +
        'Staff 1 ("Ravi") uses your own account\'s phone number; staff need their own. ' +
        'Staff 2 ("Anu") uses your own account\'s phone number; staff need their own.',
    );
    expect((err.details as unknown[]).length).toBe(3);
  });
});

describe("collectStaffContacts", () => {
  it("returns the distinct non-blank emails and phones", () => {
    expect(
      collectStaffContacts([
        { email: "a@x.com", phone: "9123456780" },
        { email: "a@x.com", phone: null },
        { email: null, phone: "9123456781" },
      ]),
    ).toEqual({ emails: ["a@x.com"], phones: ["9123456780", "9123456781"] });
  });
});
