import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, PERMISSION_GROUPS, ROLE_TEMPLATES, PERMISSIONS as P, isPermission } from "./rbac/permissions";
import { assertOnboardingTransition } from "./onboarding/onboarding.service";
import { assertTicketTransition } from "./tickets/tickets.service";
import { deriveTransactionStatus } from "./transactions/transactions.service";
import { applyContactMasking, maskEmail, maskPhone } from "./shared/pii";
import { base32Decode, base32Encode, generateSecret, generateTotp, verifyTotp } from "./auth/totp";
import { ApiError, toInt32 } from "./shared/apiError";
import { accumulateSignups } from "./analytics/analytics.service";

/**
 * These cover the rules that decide who can do what and what a number means —
 * the places where a quiet mistake would be invisible in the UI but wrong in
 * production.
 */

describe("permission catalog", () => {
  it("puts every permission in exactly one group", () => {
    const grouped = PERMISSION_GROUPS.flatMap((group) => group.permissions.map((p) => p.key));
    expect([...grouped].sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("only recognises catalog entries as permissions", () => {
    expect(isPermission(P.RESTAURANT_SUSPEND)).toBe(true);
    expect(isPermission("RESTAURANT_DELETE_EVERYTHING")).toBe(false);
  });

  it("gives Super Admin every permission", () => {
    const superAdmin = ROLE_TEMPLATES.find((r) => r.key === "SUPER_ADMIN")!;
    expect([...superAdmin.permissions].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it("references only real permissions in every role template", () => {
    for (const role of ROLE_TEMPLATES) {
      const unknown = role.permissions.filter((p) => !isPermission(p));
      expect(unknown, `${role.key} has unknown permissions`).toEqual([]);
    }
  });

  // The brief is explicit that these roles must not pick up this access by
  // default. A future edit that widens them should have to change this test.
  it("withholds customer PII and financial data from engineering", () => {
    const engineering = ROLE_TEMPLATES.find((r) => r.key === "ENGINEERING")!;
    expect(engineering.permissions).not.toContain(P.CUSTOMER_PII_VIEW);
    expect(engineering.permissions).not.toContain(P.ANALYTICS_FINANCIAL_VIEW);
    expect(engineering.permissions).not.toContain(P.REPORT_EXPORT);
  });

  // Refunds and settlements were removed outright rather than left greyed out:
  // both assume DineInk holds diners' money and pays restaurants out, which is
  // not the business. There is no payment gateway and no settlement model —
  // a refund happens in the restaurant's own app. This guards against them
  // creeping back in from the generic brief.
  it("has no refund or settlement permissions", () => {
    const suspicious = ALL_PERMISSIONS.filter((p) => /^(REFUND|SETTLEMENT)_/.test(p));
    expect(suspicious).toEqual([]);
  });

  it("withholds unmasked customer contact details from support", () => {
    const support = ROLE_TEMPLATES.find((r) => r.key === "SUPPORT")!;
    expect(support.permissions).toContain(P.CUSTOMER_VIEW);
    expect(support.permissions).not.toContain(P.CUSTOMER_PII_VIEW);
  });

  it("withholds customer and financial data from sales", () => {
    const sales = ROLE_TEMPLATES.find((r) => r.key === "SALES")!;
    expect(sales.permissions).not.toContain(P.CUSTOMER_VIEW);
    expect(sales.permissions).not.toContain(P.TRANSACTION_VIEW);
  });

  it("gives only Super Admin the ability to change roles", () => {
    const withRoleManage = ROLE_TEMPLATES.filter((r) => r.permissions.includes(P.ROLE_MANAGE));
    expect(withRoleManage.map((r) => r.key)).toEqual(["SUPER_ADMIN"]);
  });

  it("keeps Analyst read-only", () => {
    const analyst = ROLE_TEMPLATES.find((r) => r.key === "ANALYST")!;
    const writes = analyst.permissions.filter((p) =>
      /_(CREATE|EDIT|UPDATE|MANAGE|DISABLE|APPROVE|ACTIVATE|SUSPEND|ASSIGN|ESCALATE)$/.test(p),
    );
    expect(writes).toEqual([]);
  });
});

describe("onboarding lifecycle", () => {
  /**
   * Onboarding status is the delivery lifecycle and nothing else. It used to be
   * one column on Restaurant shared with the commercial lifecycle, which made a
   * signed, paying customer mid-configuration indistinguishable from a cold
   * lead.
   */
  it("moves forward one step at a time", () => {
    expect(() => assertOnboardingTransition("NOT_STARTED", "IN_PROGRESS")).not.toThrow();
    expect(() => assertOnboardingTransition("IN_PROGRESS", "READY_FOR_GO_LIVE")).not.toThrow();
  });

  it("refuses to skip straight from not-started to ready", () => {
    expect(() => assertOnboardingTransition("NOT_STARTED", "READY_FOR_GO_LIVE")).toThrow(
      /can't move from/i,
    );
  });

  it("routes going live through the go-live action, so the checklist gate always runs", () => {
    expect(() => assertOnboardingTransition("READY_FOR_GO_LIVE", "LIVE")).toThrow(/Go live/i);
  });

  it("requires a stated blocker when blocking", () => {
    expect(() => assertOnboardingTransition("IN_PROGRESS", "BLOCKED")).toThrow(/blocking/i);
    expect(() => assertOnboardingTransition("IN_PROGRESS", "BLOCKED", "waiting on GST certificate")).not.toThrow();
  });

  it("lets a blocked onboarding resume", () => {
    expect(() => assertOnboardingTransition("BLOCKED", "IN_PROGRESS")).not.toThrow();
  });

  it("treats a completed onboarding as finished", () => {
    expect(() => assertOnboardingTransition("COMPLETED", "IN_PROGRESS")).toThrow(/complete/i);
  });

  it("rejects a no-op transition rather than writing a pointless event", () => {
    expect(() => assertOnboardingTransition("IN_PROGRESS", "IN_PROGRESS")).toThrow(/already/i);
  });
});

describe("ticket transitions", () => {
  it("allows the normal support path", () => {
    expect(() => assertTicketTransition("NEW", "TRIAGED")).not.toThrow();
    expect(() => assertTicketTransition("TRIAGED", "IN_PROGRESS")).not.toThrow();
    expect(() => assertTicketTransition("IN_PROGRESS", "RESOLVED")).not.toThrow();
    expect(() => assertTicketTransition("RESOLVED", "CLOSED")).not.toThrow();
  });

  it("allows reopening a resolved ticket that failed verification", () => {
    expect(() => assertTicketTransition("VERIFICATION", "IN_PROGRESS")).not.toThrow();
    expect(() => assertTicketTransition("RESOLVED", "IN_PROGRESS")).not.toThrow();
  });

  it("refuses to move a closed ticket", () => {
    try {
      assertTicketTransition("CLOSED", "IN_PROGRESS");
      throw new Error("should have thrown");
    } catch (error: any) {
      expect(error.code).toBe("INVALID_TICKET_TRANSITION");
      expect(error.message).toMatch(/closed/i);
    }
  });

  it("routes escalation through the escalate action", () => {
    try {
      assertTicketTransition("IN_PROGRESS", "ESCALATED_TO_ENGINEERING");
      throw new Error("should have thrown");
    } catch (error: any) {
      expect(error.code).toBe("USE_ESCALATE_ACTION");
    }
  });

  it("rejects a no-op status change", () => {
    try {
      assertTicketTransition("NEW", "NEW");
      throw new Error("should have thrown");
    } catch (error: any) {
      expect(error.code).toBe("STATUS_UNCHANGED");
    }
  });
});

describe("transaction status", () => {
  it("maps payment states", () => {
    expect(deriveTransactionStatus({ status: "PAID", total: 500 })).toBe("SUCCESS");
    expect(deriveTransactionStatus({ status: "UNPAID", total: 500 })).toBe("INITIATED");
    expect(deriveTransactionStatus({ status: "PARTIAL", total: 500 })).toBe("PROCESSING");
    expect(deriveTransactionStatus({ status: "CANCELLED", total: 500 })).toBe("CANCELLED");
  });

  // Bill.total is reduced by each refund, so a fully refunded ₹500 bill has
  // total 0 and refundedAmount 500. Comparing the refund against `total` alone
  // would call this partial.
  it("recognises a full refund once total has been reduced to zero", () => {
    expect(deriveTransactionStatus({ status: "PAID", total: 0, refundedAmount: 500 })).toBe("REFUNDED");
  });

  it("recognises a partial refund", () => {
    expect(deriveTransactionStatus({ status: "PAID", total: 400, refundedAmount: 100 })).toBe("PARTIALLY_REFUNDED");
  });

  it("tolerates floating-point drift on a full refund", () => {
    expect(deriveTransactionStatus({ status: "PAID", total: 0.001, refundedAmount: 499.999 })).toBe("REFUNDED");
  });
});

describe("PII masking", () => {
  it("keeps the last four digits of a phone number", () => {
    expect(maskPhone("9876543210")).toBe("••••••3210");
    // Formatting is stripped first, so the same number with a country code and
    // spaces masks to the same visible suffix — an agent comparing what a
    // caller reads out shouldn't get a different answer because of punctuation.
    expect(maskPhone("+91 98765 43210")).toBe("••••••••3210");
  });

  it("keeps the domain of an email but hides the local part", () => {
    expect(maskEmail("priya.sharma@gmail.com")).toBe("p•••••••••••@gmail.com");
  });

  it("passes null and undefined through untouched", () => {
    expect(maskPhone(null)).toBeNull();
    expect(maskEmail(undefined)).toBeNull();
  });

  it("returns real values and flags them when the caller holds the permission", () => {
    const record = { name: "Priya Sharma", phone: "9876543210", email: "p@x.com", address: "12 MG Road, Bengaluru" };
    const unmasked = applyContactMasking(record, true);
    expect(unmasked.phone).toBe("9876543210");
    expect(unmasked.piiMasked).toBe(false);
  });

  it("masks and flags when the caller does not", () => {
    const record = { name: "Priya Sharma", phone: "9876543210", email: "p@x.com", address: "12 MG Road, Bengaluru" };
    const masked = applyContactMasking(record, false);
    expect(masked.phone).not.toBe("9876543210");
    expect(masked.email).not.toBe("p@x.com");
    expect(masked.address).toBe("•••, Bengaluru");
    expect(masked.piiMasked).toBe(true);
  });
});

describe("TOTP", () => {
  it("round-trips base32", () => {
    const buffer = Buffer.from("DineInk internal", "utf8");
    expect(base32Decode(base32Encode(buffer)).toString("utf8")).toBe("DineInk internal");
  });

  it("accepts a code generated for the same moment", () => {
    const secret = generateSecret();
    const now = Date.now();
    expect(verifyTotp(secret, generateTotp(secret, now), now)).toBe(true);
  });

  it("accepts one step of clock drift either side", () => {
    const secret = generateSecret();
    const now = Date.now();
    expect(verifyTotp(secret, generateTotp(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, generateTotp(secret, now + 30_000), now)).toBe(true);
  });

  it("rejects a code from further away in time", () => {
    const secret = generateSecret();
    const now = Date.now();
    expect(verifyTotp(secret, generateTotp(secret, now - 5 * 60_000), now)).toBe(false);
  });

  it("rejects malformed input without throwing", () => {
    const secret = generateSecret();
    expect(verifyTotp(secret, "")).toBe(false);
    expect(verifyTotp(secret, "abcdef")).toBe(false);
    expect(verifyTotp(secret, "12345")).toBe(false);
    expect(verifyTotp(secret, "1234567")).toBe(false);
  });

  it("rejects a valid code for a different secret", () => {
    const now = Date.now();
    const code = generateTotp(generateSecret(), now);
    expect(verifyTotp(generateSecret(), code, now)).toBe(false);
  });
});

describe("application log capture", () => {
  /**
   * Regression: the id parsed out of the URL used to be passed to Prisma raw.
   * `/restaurants/99999999999999999999` became 1e20, which overflows int4 and
   * made the write recording the error fail — so the only errors that went
   * unrecorded were the ones caused by absurd input, which is exactly the class
   * worth seeing.
   */
  it("drops ids that would overflow the column rather than losing the log line", () => {
    expect(toInt32("99999999999999999999")).toBeNull();
    expect(toInt32("2147483648")).toBeNull();
    expect(toInt32("2147483647")).toBe(2_147_483_647);
    expect(toInt32("248")).toBe(248);
  });

  it("treats a missing or unusable segment as no id", () => {
    expect(toInt32(undefined)).toBeNull();
    expect(toInt32("")).toBeNull();
    expect(toInt32("0")).toBeNull();
    expect(toInt32("abc")).toBeNull();
  });
});

describe("account growth series", () => {
  const day = (n: number) => new Date(Date.UTC(2026, 0, n));

  /**
   * Regression: the chart is titled "accounts over time" and was being fed the
   * day's intake. A quiet Tuesday after a busy Monday drew a downward slope,
   * which reads as accounts leaving the platform — they never do; churn is a
   * status change, not a deletion.
   */
  it("never falls, whatever the daily intake looks like", () => {
    const series = accumulateSignups(
      [
        { day: day(1), count: 4n },
        { day: day(2), count: 1n },
        { day: day(3), count: 0n },
        { day: day(4), count: 7n },
      ],
      0,
    );
    expect(series.map((point) => point.count)).toEqual([4, 5, 5, 12]);
    for (let i = 1; i < series.length; i += 1) {
      expect(series[i].count).toBeGreaterThanOrEqual(series[i - 1].count);
    }
  });

  it("starts from the accounts that already existed before the range", () => {
    const series = accumulateSignups([{ day: day(1), count: 2n }], 100);
    expect(series[0].count).toBe(102);
  });

  it("returns nothing for a range with no sign-ups", () => {
    expect(accumulateSignups([], 6)).toEqual([]);
  });
});
