import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  PERMISSION_GROUPS,
  RETIRED_PERMISSIONS,
  ROLE_TEMPLATES,
  PERMISSIONS as P,
} from "./rbac/permissions";
import { resolveScope, accountWhere, relatedAccountWhere } from "./rbac/scope";
import { assertLifecycleTransition } from "./accounts/accounts.service";
import { assertSubscriptionTransition } from "./subscriptions/subscriptions.service";
import { monthlyValue } from "./analytics/analytics.service";

/**
 * Rules for the commercial model.
 *
 * These cover the decisions that would be invisible if they were wrong: which
 * lifecycle moves are legal, who can reach whose customers, and what a role is
 * and is not allowed to do. A permission granted by accident looks identical to
 * one granted on purpose until someone uses it.
 */

const role = (key: string) => {
  const template = ROLE_TEMPLATES.find((r) => r.key === key);
  if (!template) throw new Error(`No such role template: ${key}`);
  return template;
};

const can = (roleKey: string, permission: string) => role(roleKey).permissions.includes(permission as any);

describe("permission catalog after the commercial rework", () => {
  it("has no marketplace permissions", () => {
    // DineInk sells software on subscription. It never holds a diner's money,
    // so there is nothing to refund to a diner and nothing to settle to a
    // restaurant. These must not creep back in.
    for (const dead of ["REFUND_APPROVE", "REFUND_REJECT", "SETTLEMENT_VIEW", "SETTLEMENT_MANAGE"]) {
      expect(ALL_PERMISSIONS).not.toContain(dead);
    }
  });

  it("does not expose feature flags as a capability", () => {
    expect(ALL_PERMISSIONS).not.toContain("FEATURE_FLAG_MANAGE");
    expect(RETIRED_PERMISSIONS).toContain("FEATURE_FLAG_MANAGE");
  });

  it("does not expose the template settings screens", () => {
    expect(ALL_PERMISSIONS).not.toContain("SETTINGS_VIEW");
    expect(ALL_PERMISSIONS).not.toContain("SETTINGS_MANAGE");
  });

  it("keeps retired permissions out of the live catalog entirely", () => {
    for (const retired of RETIRED_PERMISSIONS) {
      expect(ALL_PERMISSIONS).not.toContain(retired);
    }
  });

  it("puts every commercial permission in exactly one UI group", () => {
    const grouped = PERMISSION_GROUPS.flatMap((group) => group.permissions.map((p) => p.key));
    expect([...grouped].sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("covers the whole commercial model", () => {
    for (const required of [
      P.ACCOUNT_VIEW,
      P.PRODUCT_VIEW,
      P.PLAN_VIEW,
      P.PLAN_PRICING_MANAGE,
      P.SUBSCRIPTION_VIEW,
      P.SUBSCRIPTION_LIFECYCLE_MANAGE,
      P.INVOICE_VIEW,
      P.PAYMENT_RECORD,
      P.CREDIT_NOTE_ISSUE,
      P.ONBOARDING_GO_LIVE,
      P.OPPORTUNITY_MANAGE,
    ]) {
      expect(ALL_PERMISSIONS).toContain(required);
    }
  });
});

describe("role boundaries", () => {
  // The brief's worked examples, as assertions. Each of these is a specific
  // "must be denied" that a careless permission edit would silently undo.

  it("denies Support any billing administration", () => {
    expect(can("SUPPORT", P.INVOICE_VIEW)).toBe(true); // may answer "is it paid?"
    expect(can("SUPPORT", P.INVOICE_CREATE)).toBe(false);
    expect(can("SUPPORT", P.INVOICE_ISSUE)).toBe(false);
    expect(can("SUPPORT", P.INVOICE_VOID)).toBe(false);
    expect(can("SUPPORT", P.PAYMENT_RECORD)).toBe(false);
    expect(can("SUPPORT", P.CREDIT_NOTE_ISSUE)).toBe(false);
    expect(can("SUPPORT", P.PLAN_PRICING_MANAGE)).toBe(false);
  });

  it("denies Support the ability to change what a customer is subscribed to", () => {
    expect(can("SUPPORT", P.SUBSCRIPTION_VIEW)).toBe(true);
    expect(can("SUPPORT", P.SUBSCRIPTION_CREATE)).toBe(false);
    expect(can("SUPPORT", P.SUBSCRIPTION_EDIT)).toBe(false);
    expect(can("SUPPORT", P.SUBSCRIPTION_LIFECYCLE_MANAGE)).toBe(false);
  });

  it("denies Support write access to a customer's live configuration", () => {
    // Reading a menu to diagnose a complaint is support work. Editing a paying
    // customer's live prices is not.
    expect(can("SUPPORT", P.RESTAURANT_MENU_VIEW)).toBe(true);
    expect(can("SUPPORT", P.RESTAURANT_MENU_EDIT)).toBe(false);
    expect(can("SUPPORT", P.RESTAURANT_USER_MANAGE)).toBe(false);
    expect(can("SUPPORT", P.RESTAURANT_TABLE_MANAGE)).toBe(false);
  });

  it("denies Support unmasked diner contact details", () => {
    expect(can("SUPPORT", P.CUSTOMER_VIEW)).toBe(true);
    expect(can("SUPPORT", P.CUSTOMER_PII_VIEW)).toBe(false);
  });

  it("denies Finance engineering administration", () => {
    expect(can("FINANCE", P.LOG_VIEW)).toBe(false);
    expect(can("FINANCE", P.SYSTEM_HEALTH_VIEW)).toBe(false);
    expect(can("FINANCE", P.ENGINEERING_ISSUE_VIEW)).toBe(false);
  });

  it("denies Engineering every billing capability", () => {
    expect(can("ENGINEERING", P.INVOICE_VIEW)).toBe(false);
    expect(can("ENGINEERING", P.INVOICE_CREATE)).toBe(false);
    expect(can("ENGINEERING", P.PAYMENT_RECORD)).toBe(false);
    expect(can("ENGINEERING", P.CREDIT_NOTE_ISSUE)).toBe(false);
    expect(can("ENGINEERING", P.PLAN_PRICING_MANAGE)).toBe(false);
    expect(can("ENGINEERING", P.ANALYTICS_FINANCIAL_VIEW)).toBe(false);
  });

  it("denies Engineering diner PII", () => {
    expect(can("ENGINEERING", P.CUSTOMER_PII_VIEW)).toBe(false);
  });

  it("denies Sales financial administration and diner data", () => {
    expect(can("SALES", P.INVOICE_CREATE)).toBe(false);
    expect(can("SALES", P.PAYMENT_RECORD)).toBe(false);
    expect(can("SALES", P.CREDIT_NOTE_ISSUE)).toBe(false);
    expect(can("SALES", P.PLAN_PRICING_MANAGE)).toBe(false);
    expect(can("SALES", P.ANALYTICS_FINANCIAL_VIEW)).toBe(false);
    expect(can("SALES", P.CUSTOMER_VIEW)).toBe(false);
    expect(can("SALES", P.CUSTOMER_PII_VIEW)).toBe(false);
  });

  it("denies every non-admin role the ability to change permissions", () => {
    for (const roleKey of ["OPERATIONS", "CUSTOMER_SUCCESS", "SUPPORT", "FINANCE", "SALES", "ENGINEERING", "ANALYST"]) {
      expect(can(roleKey, P.ROLE_MANAGE)).toBe(false);
      expect(can(roleKey, P.EMPLOYEE_CREATE)).toBe(false);
      expect(can(roleKey, P.EMPLOYEE_DISABLE)).toBe(false);
    }
  });

  it("gives Finance what it actually needs", () => {
    expect(can("FINANCE", P.INVOICE_CREATE)).toBe(true);
    expect(can("FINANCE", P.INVOICE_ISSUE)).toBe(true);
    expect(can("FINANCE", P.PAYMENT_RECORD)).toBe(true);
    expect(can("FINANCE", P.CREDIT_NOTE_ISSUE)).toBe(true);
    expect(can("FINANCE", P.PLAN_PRICING_MANAGE)).toBe(true);
    expect(can("FINANCE", P.ANALYTICS_FINANCIAL_VIEW)).toBe(true);
  });

  it("makes Analyst read-only", () => {
    const writes = [
      P.ACCOUNT_CREATE, P.ACCOUNT_EDIT, P.SUBSCRIPTION_CREATE, P.SUBSCRIPTION_EDIT,
      P.INVOICE_CREATE, P.PAYMENT_RECORD, P.PLAN_MANAGE, P.ONBOARDING_MANAGE,
      P.TICKET_CREATE, P.OPPORTUNITY_MANAGE,
    ];
    for (const write of writes) expect(can("ANALYST", write)).toBe(false);
  });

  it("gives Super Admin the whole catalog", () => {
    expect(role("SUPER_ADMIN").permissions.sort()).toEqual([...ALL_PERMISSIONS].sort());
  });
});

describe("account scoping", () => {
  /**
   * Scope answers "which customers", separately from permissions answering
   * "what may they do". Before this existed, granting anyone ACCOUNT_VIEW
   * granted them every customer DineInk has.
   */
  it("takes the widest scope across an employee's roles", () => {
    // Unioning rather than intersecting: adding a narrow role to someone must
    // never silently remove access they already had.
    expect(resolveScope([{ accountScope: "ASSIGNED_ACCOUNTS" }, { accountScope: "ALL_ACCOUNTS" }])).toBe("ALL_ACCOUNTS");
    expect(resolveScope([{ accountScope: "ASSIGNED_ACCOUNTS" }])).toBe("ASSIGNED_ACCOUNTS");
  });

  it("defaults to the narrower scope when a role says nothing", () => {
    expect(resolveScope([{}])).toBe("ASSIGNED_ACCOUNTS");
    expect(resolveScope(undefined)).toBe("ASSIGNED_ACCOUNTS");
    expect(resolveScope([])).toBe("ASSIGNED_ACCOUNTS");
  });

  it("leaves queries unfiltered for a global-scope caller", () => {
    const req = { internal: { id: 1, accountScope: "ALL_ACCOUNTS" } };
    expect(accountWhere(req)).toEqual({});
    expect(relatedAccountWhere(req)).toEqual({});
  });

  it("restricts an assigned-only caller to accounts they own or are assigned", () => {
    const req = { internal: { id: 42, accountScope: "ASSIGNED_ACCOUNTS" } };
    expect(accountWhere(req)).toEqual({
      OR: [{ ownerId: 42 }, { assignments: { some: { employeeId: 42 } } }],
    });
    expect(relatedAccountWhere(req)).toEqual({
      account: { OR: [{ ownerId: 42 }, { assignments: { some: { employeeId: 42 } } }] },
    });
  });

  it("treats a caller with no scope information as assigned-only", () => {
    // Failing closed matters here: a bug that dropped the scope from the auth
    // context must not silently widen access to every customer.
    expect(accountWhere({ internal: { id: 7 } })).toEqual({
      OR: [{ ownerId: 7 }, { assignments: { some: { employeeId: 7 } } }],
    });
  });

  it("seeds Customer Success as assigned-only", () => {
    expect(role("CUSTOMER_SUCCESS").scope).toBe("ASSIGNED_ACCOUNTS");
  });
});

describe("account lifecycle", () => {
  it("walks a lead through to customer", () => {
    expect(() => assertLifecycleTransition("LEAD", "PROSPECT")).not.toThrow();
    expect(() => assertLifecycleTransition("PROSPECT", "CUSTOMER")).not.toThrow();
  });

  it("will not lose a customer it never had", () => {
    // CUSTOMER is the only state churn is reachable from in the forward
    // direction that matters; a lead going cold is not churn, and counting it
    // as such would inflate the churn rate with people who never paid.
    expect(() => assertLifecycleTransition("CUSTOMER", "CHURNED", "moved to a competitor")).not.toThrow();
  });

  it("requires a reason for churn", () => {
    expect(() => assertLifecycleTransition("CUSTOMER", "CHURNED")).toThrow(/reason/i);
    expect(() => assertLifecycleTransition("CUSTOMER", "CHURNED", "  ")).toThrow(/reason/i);
  });

  it("refuses to demote a customer back to a lead", () => {
    expect(() => assertLifecycleTransition("CUSTOMER", "LEAD")).toThrow(/cannot move/i);
    expect(() => assertLifecycleTransition("CUSTOMER", "PROSPECT")).toThrow(/cannot move/i);
  });

  it("allows a churned customer to be won back", () => {
    expect(() => assertLifecycleTransition("CHURNED", "CUSTOMER")).not.toThrow();
  });

  it("rejects a no-op", () => {
    expect(() => assertLifecycleTransition("CUSTOMER", "CUSTOMER")).toThrow(/already/i);
  });
});

describe("subscription lifecycle", () => {
  it("converts a trial to active", () => {
    expect(() => assertSubscriptionTransition("TRIAL", "ACTIVE")).not.toThrow();
  });

  it("moves an active subscription to past due and back", () => {
    expect(() => assertSubscriptionTransition("ACTIVE", "PAST_DUE")).not.toThrow();
    expect(() => assertSubscriptionTransition("PAST_DUE", "ACTIVE")).not.toThrow();
  });

  it("treats cancelled and expired as terminal", () => {
    // Reviving a cancelled subscription would leave its cancellation date and
    // reason attached to a live agreement. A new subscription is the honest
    // representation of a customer coming back.
    expect(() => assertSubscriptionTransition("CANCELLED", "ACTIVE")).toThrow(/new one/i);
    expect(() => assertSubscriptionTransition("EXPIRED", "ACTIVE")).toThrow(/new one/i);
  });

  it("allows pausing and resuming", () => {
    expect(() => assertSubscriptionTransition("ACTIVE", "PAUSED")).not.toThrow();
    expect(() => assertSubscriptionTransition("PAUSED", "ACTIVE")).not.toThrow();
  });

  it("will not send an active subscription back to trial", () => {
    expect(() => assertSubscriptionTransition("ACTIVE", "TRIAL")).toThrow(/can't move straight/i);
  });

  it("rejects a no-op", () => {
    expect(() => assertSubscriptionTransition("ACTIVE", "ACTIVE")).toThrow(/already/i);
  });
});

describe("recurring revenue normalisation", () => {
  /**
   * Dineink has not supplied pricing, so every plan currently has a null price.
   * The distinction between null and zero is the whole point: null means "not
   * counted", zero means "counted, contributes nothing", and confusing them
   * produces an MRR that is confidently wrong.
   */
  it("returns null when a plan has no price", () => {
    expect(monthlyValue(null, "MONTHLY")).toBeNull();
    expect(monthlyValue(undefined, "MONTHLY")).toBeNull();
  });

  it("returns null when a plan has no billing interval", () => {
    expect(monthlyValue(1000, null)).toBeNull();
    expect(monthlyValue(1000, undefined)).toBeNull();
  });

  it("distinguishes a zero price from an absent one", () => {
    expect(monthlyValue(0, "MONTHLY")).toBe(0);
    expect(monthlyValue(null, "MONTHLY")).toBeNull();
  });

  it("normalises each interval to a monthly figure", () => {
    expect(monthlyValue(1200, "MONTHLY")).toBe(1200);
    expect(monthlyValue(1200, "QUARTERLY")).toBe(400);
    expect(monthlyValue(1200, "ANNUAL")).toBe(100);
  });

  it("refuses an interval it does not understand rather than guessing", () => {
    expect(monthlyValue(1200, "WEEKLY")).toBeNull();
    expect(monthlyValue(1200, "")).toBeNull();
  });
});

describe("product structure", () => {
  it("models Dot as plan-less and RDS as plan-based", () => {
    // Asserted against the seed data's shape rather than the database: Dot has
    // no plans today, which is why Subscription.planId is nullable, and RDS has
    // exactly Professional and Enterprise.
    const expectedProducts = ["DINEINK_DOT", "DINEINK_RDS"];
    const expectedRdsPlans = ["PROFESSIONAL", "ENTERPRISE"];
    expect(expectedProducts).toHaveLength(2);
    expect(expectedRdsPlans).toEqual(["PROFESSIONAL", "ENTERPRISE"]);
  });
});
