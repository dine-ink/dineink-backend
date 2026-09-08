/**
 * The permission catalog for the DineInk internal application.
 *
 * This file — not the database — is the source of truth for which permissions
 * exist. InternalRolePermission stores plain strings, so if the catalog lived in
 * the database a typo would create a permission that no route ever checks: it
 * would look granted in the admin UI and deny nothing. Keeping the list in code
 * means `requirePermission(P.ACCOUNT_SUSPEND)` fails to compile if the
 * permission is misspelled, and the roles screen can only offer real ones.
 *
 * Authorization is checked against permissions, never role names. A role is just
 * a bundle; renaming "Operations" or adding a ninth role must never require
 * touching a route.
 *
 * Permissions answer "what may this person do". They do NOT answer "to which
 * customers" — that is the scope dimension, and it lives in scope.ts.
 */

export const PERMISSIONS = {
  // ─── Accounts (the commercial customer) ────────────────────────────────────
  ACCOUNT_VIEW: "ACCOUNT_VIEW",
  ACCOUNT_CREATE: "ACCOUNT_CREATE",
  ACCOUNT_EDIT: "ACCOUNT_EDIT",
  /// Move an account between LEAD / PROSPECT / CUSTOMER / CHURNED.
  ACCOUNT_LIFECYCLE_MANAGE: "ACCOUNT_LIFECYCLE_MANAGE",
  ACCOUNT_CONTACT_VIEW: "ACCOUNT_CONTACT_VIEW",
  ACCOUNT_CONTACT_MANAGE: "ACCOUNT_CONTACT_MANAGE",
  /// Decide which employees may reach which accounts. Effectively a grant of
  /// data access, so it is held tightly.
  ACCOUNT_ASSIGNMENT_MANAGE: "ACCOUNT_ASSIGNMENT_MANAGE",
  /// GST, billing address, agreement detail on the account.
  ACCOUNT_FINANCIAL_VIEW: "ACCOUNT_FINANCIAL_VIEW",

  // ─── Product catalogue ─────────────────────────────────────────────────────
  PRODUCT_VIEW: "PRODUCT_VIEW",
  PRODUCT_MANAGE: "PRODUCT_MANAGE",
  PLAN_VIEW: "PLAN_VIEW",
  PLAN_MANAGE: "PLAN_MANAGE",
  /// Setting a price is a commercial decision distinct from editing a plan's
  /// name or description, and belongs to Finance rather than to whoever
  /// maintains the catalogue copy.
  PLAN_PRICING_MANAGE: "PLAN_PRICING_MANAGE",

  // ─── Subscriptions ─────────────────────────────────────────────────────────
  SUBSCRIPTION_VIEW: "SUBSCRIPTION_VIEW",
  SUBSCRIPTION_CREATE: "SUBSCRIPTION_CREATE",
  SUBSCRIPTION_EDIT: "SUBSCRIPTION_EDIT",
  /// Status moves, plan changes and cancellation — the actions that change what
  /// a customer is entitled to and what they owe.
  SUBSCRIPTION_LIFECYCLE_MANAGE: "SUBSCRIPTION_LIFECYCLE_MANAGE",

  // ─── Billing ───────────────────────────────────────────────────────────────
  INVOICE_VIEW: "INVOICE_VIEW",
  INVOICE_CREATE: "INVOICE_CREATE",
  INVOICE_EDIT: "INVOICE_EDIT",
  INVOICE_ISSUE: "INVOICE_ISSUE",
  INVOICE_VOID: "INVOICE_VOID",
  PAYMENT_VIEW: "PAYMENT_VIEW",
  PAYMENT_RECORD: "PAYMENT_RECORD",
  CREDIT_NOTE_VIEW: "CREDIT_NOTE_VIEW",
  CREDIT_NOTE_ISSUE: "CREDIT_NOTE_ISSUE",

  // ─── Locations (a customer's outlets, as operated in the product) ──────────
  LOCATION_VIEW: "LOCATION_VIEW",
  LOCATION_MANAGE: "LOCATION_MANAGE",

  // ─── Restaurants (the product tenant behind an account) ────────────────────
  RESTAURANT_VIEW: "RESTAURANT_VIEW",
  RESTAURANT_CREATE: "RESTAURANT_CREATE",
  RESTAURANT_EDIT: "RESTAURANT_EDIT",
  RESTAURANT_ACTIVATE: "RESTAURANT_ACTIVATE",
  RESTAURANT_SUSPEND: "RESTAURANT_SUSPEND",
  RESTAURANT_USER_VIEW: "RESTAURANT_USER_VIEW",
  RESTAURANT_USER_MANAGE: "RESTAURANT_USER_MANAGE",
  RESTAURANT_MENU_VIEW: "RESTAURANT_MENU_VIEW",
  RESTAURANT_MENU_EDIT: "RESTAURANT_MENU_EDIT",
  RESTAURANT_TABLE_VIEW: "RESTAURANT_TABLE_VIEW",
  RESTAURANT_TABLE_MANAGE: "RESTAURANT_TABLE_MANAGE",
  RESTAURANT_FINANCIAL_VIEW: "RESTAURANT_FINANCIAL_VIEW",

  // ─── Onboarding ────────────────────────────────────────────────────────────
  ONBOARDING_VIEW: "ONBOARDING_VIEW",
  ONBOARDING_MANAGE: "ONBOARDING_MANAGE",
  /// Declaring a customer live. Held apart from ordinary checklist work.
  ONBOARDING_GO_LIVE: "ONBOARDING_GO_LIVE",

  // ─── Diners and their orders (our customers' customers) ────────────────────
  CUSTOMER_VIEW: "CUSTOMER_VIEW",
  /// Unmasked phone/email/address. CUSTOMER_VIEW alone shows masked values.
  CUSTOMER_PII_VIEW: "CUSTOMER_PII_VIEW",
  ORDER_VIEW: "ORDER_VIEW",
  ORDER_UPDATE: "ORDER_UPDATE",
  TRANSACTION_VIEW: "TRANSACTION_VIEW",

  // ─── Support ───────────────────────────────────────────────────────────────
  TICKET_VIEW: "TICKET_VIEW",
  TICKET_CREATE: "TICKET_CREATE",
  TICKET_ASSIGN: "TICKET_ASSIGN",
  TICKET_UPDATE: "TICKET_UPDATE",
  TICKET_ESCALATE: "TICKET_ESCALATE",
  TICKET_ATTACHMENT_MANAGE: "TICKET_ATTACHMENT_MANAGE",

  // ─── Sales ─────────────────────────────────────────────────────────────────
  OPPORTUNITY_VIEW: "OPPORTUNITY_VIEW",
  OPPORTUNITY_MANAGE: "OPPORTUNITY_MANAGE",

  // ─── Analytics & reporting ─────────────────────────────────────────────────
  ANALYTICS_VIEW: "ANALYTICS_VIEW",
  /// Revenue, MRR/ARR, invoice totals.
  ANALYTICS_FINANCIAL_VIEW: "ANALYTICS_FINANCIAL_VIEW",
  REPORT_VIEW: "REPORT_VIEW",
  /// Export is separate from view on purpose: reading one account's numbers on
  /// screen is not the same risk as walking out with the whole customer base as
  /// a spreadsheet.
  REPORT_EXPORT: "REPORT_EXPORT",

  // ─── Engineering ───────────────────────────────────────────────────────────
  ENGINEERING_ISSUE_VIEW: "ENGINEERING_ISSUE_VIEW",
  SYSTEM_HEALTH_VIEW: "SYSTEM_HEALTH_VIEW",
  LOG_VIEW: "LOG_VIEW",

  // ─── Administration ────────────────────────────────────────────────────────
  EMPLOYEE_VIEW: "EMPLOYEE_VIEW",
  EMPLOYEE_CREATE: "EMPLOYEE_CREATE",
  EMPLOYEE_UPDATE: "EMPLOYEE_UPDATE",
  EMPLOYEE_DISABLE: "EMPLOYEE_DISABLE",
  ROLE_VIEW: "ROLE_VIEW",
  ROLE_MANAGE: "ROLE_MANAGE",
  AUDIT_VIEW: "AUDIT_VIEW",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

export const isPermission = (value: string): value is Permission =>
  (ALL_PERMISSIONS as string[]).includes(value);

/**
 * Permissions removed when the business model was corrected.
 *
 * Kept as a list rather than deleted silently so that the role editor can clean
 * stale grants out of InternalRolePermission instead of leaving rows that grant
 * something no route checks. Every entry here describes a capability DineInk
 * does not have:
 *
 *  - REFUND_* / SETTLEMENT_*      marketplace payouts; DineInk never holds a
 *                                 diner's money
 *  - FEATURE_FLAG_MANAGE          not a DinkDesk module
 *  - SETTINGS_*                   the five template settings screens are gone
 *  - NOTIFICATION_*               granted access to a module that never existed
 *  - RESTAURANT_ONBOARDING_MANAGE superseded by ONBOARDING_MANAGE, which is
 *                                 account-scoped rather than restaurant-scoped
 */
export const RETIRED_PERMISSIONS: string[] = [
  "REFUND_VIEW",
  "REFUND_APPROVE",
  "REFUND_REJECT",
  "SETTLEMENT_VIEW",
  "SETTLEMENT_MANAGE",
  "FEATURE_FLAG_MANAGE",
  "SETTINGS_VIEW",
  "SETTINGS_MANAGE",
  "NOTIFICATION_VIEW",
  "NOTIFICATION_MANAGE",
  "RESTAURANT_ONBOARDING_MANAGE",
  "COPILOT_USE",
];

/**
 * Grouping and human copy for the Roles & Permissions admin screen. Every
 * permission must appear in exactly one group — `assertCatalogComplete` below
 * is called at module load so a newly added permission can't be silently
 * missing from the UI.
 */
export interface PermissionGroup {
  key: string;
  label: string;
  permissions: { key: Permission; label: string; description: string; sensitive?: boolean }[];
}

const P = PERMISSIONS;

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: "accounts",
    label: "Customers",
    permissions: [
      { key: P.ACCOUNT_VIEW, label: "View customers", description: "Search and open customer accounts" },
      { key: P.ACCOUNT_CREATE, label: "Create customers", description: "Add a customer, lead or prospect" },
      { key: P.ACCOUNT_EDIT, label: "Edit customers", description: "Update business information" },
      { key: P.ACCOUNT_LIFECYCLE_MANAGE, label: "Manage customer lifecycle", description: "Convert, win and churn accounts", sensitive: true },
      { key: P.ACCOUNT_CONTACT_VIEW, label: "View contacts", description: "See a customer's named contacts" },
      { key: P.ACCOUNT_CONTACT_MANAGE, label: "Manage contacts", description: "Add, edit and remove contacts" },
      { key: P.ACCOUNT_ASSIGNMENT_MANAGE, label: "Assign customers to employees", description: "Decide who may reach which customers", sensitive: true },
      { key: P.ACCOUNT_FINANCIAL_VIEW, label: "View customer financial details", description: "GST and billing information", sensitive: true },
    ],
  },
  {
    key: "catalogue",
    label: "Products & plans",
    permissions: [
      { key: P.PRODUCT_VIEW, label: "View products", description: "See the product catalogue" },
      { key: P.PRODUCT_MANAGE, label: "Manage products", description: "Create and edit products", sensitive: true },
      { key: P.PLAN_VIEW, label: "View plans", description: "See plans and their terms" },
      { key: P.PLAN_MANAGE, label: "Manage plans", description: "Create and edit plans", sensitive: true },
      { key: P.PLAN_PRICING_MANAGE, label: "Set plan pricing", description: "Change price, currency and billing interval", sensitive: true },
    ],
  },
  {
    key: "subscriptions",
    label: "Subscriptions",
    permissions: [
      { key: P.SUBSCRIPTION_VIEW, label: "View subscriptions", description: "See what a customer has bought" },
      { key: P.SUBSCRIPTION_CREATE, label: "Create subscriptions", description: "Start a subscription for a customer", sensitive: true },
      { key: P.SUBSCRIPTION_EDIT, label: "Edit subscriptions", description: "Adjust dates, seats and notes" },
      { key: P.SUBSCRIPTION_LIFECYCLE_MANAGE, label: "Manage subscription lifecycle", description: "Activate, pause, change plan and cancel", sensitive: true },
    ],
  },
  {
    key: "billing",
    label: "Billing",
    permissions: [
      { key: P.INVOICE_VIEW, label: "View invoices", description: "See invoices raised to customers" },
      { key: P.INVOICE_CREATE, label: "Create invoices", description: "Draft a new invoice", sensitive: true },
      { key: P.INVOICE_EDIT, label: "Edit draft invoices", description: "Change lines on a draft" },
      { key: P.INVOICE_ISSUE, label: "Issue invoices", description: "Move an invoice from draft to issued", sensitive: true },
      { key: P.INVOICE_VOID, label: "Void invoices", description: "Cancel an issued invoice", sensitive: true },
      { key: P.PAYMENT_VIEW, label: "View payments", description: "See payments received" },
      { key: P.PAYMENT_RECORD, label: "Record payments", description: "Record a payment against an invoice", sensitive: true },
      { key: P.CREDIT_NOTE_VIEW, label: "View credit notes", description: "See credits issued to customers" },
      { key: P.CREDIT_NOTE_ISSUE, label: "Issue credit notes", description: "Credit a customer against an invoice", sensitive: true },
    ],
  },
  {
    key: "locations",
    label: "Locations",
    permissions: [
      { key: P.LOCATION_VIEW, label: "View locations", description: "See a customer's outlets" },
      { key: P.LOCATION_MANAGE, label: "Manage locations", description: "Change an outlet's operational status", sensitive: true },
    ],
  },
  {
    key: "restaurants",
    label: "Restaurant systems",
    permissions: [
      { key: P.RESTAURANT_VIEW, label: "View restaurant systems", description: "Open the product tenant behind an account" },
      { key: P.RESTAURANT_CREATE, label: "Create restaurant systems", description: "Provision a tenant for a customer" },
      { key: P.RESTAURANT_EDIT, label: "Edit restaurant systems", description: "Update tenant configuration" },
      { key: P.RESTAURANT_ACTIVATE, label: "Activate restaurant systems", description: "Take a tenant live", sensitive: true },
      { key: P.RESTAURANT_SUSPEND, label: "Suspend restaurant systems", description: "Suspend a live tenant", sensitive: true },
      { key: P.RESTAURANT_USER_VIEW, label: "View restaurant users", description: "See a customer's own staff accounts" },
      { key: P.RESTAURANT_USER_MANAGE, label: "Manage restaurant users", description: "Create, disable and reset customer staff access", sensitive: true },
      { key: P.RESTAURANT_MENU_VIEW, label: "View menu", description: "Inspect a customer's menu" },
      { key: P.RESTAURANT_MENU_EDIT, label: "Edit menu", description: "Modify a customer's live menu data", sensitive: true },
      { key: P.RESTAURANT_TABLE_VIEW, label: "View tables & QR", description: "See tables and QR status" },
      { key: P.RESTAURANT_TABLE_MANAGE, label: "Manage tables & QR", description: "Generate, regenerate and disable QR codes", sensitive: true },
      { key: P.RESTAURANT_FINANCIAL_VIEW, label: "View restaurant banking details", description: "Bank and statutory information held in the tenant", sensitive: true },
    ],
  },
  {
    key: "onboarding",
    label: "Onboarding",
    permissions: [
      { key: P.ONBOARDING_VIEW, label: "View onboarding", description: "See onboarding progress and checklists" },
      { key: P.ONBOARDING_MANAGE, label: "Manage onboarding", description: "Advance status and complete checklist items" },
      { key: P.ONBOARDING_GO_LIVE, label: "Take customers live", description: "Declare onboarding complete and the customer live", sensitive: true },
    ],
  },
  {
    key: "diners",
    label: "Diners, orders & transactions",
    permissions: [
      { key: P.CUSTOMER_VIEW, label: "View diners", description: "Search diner records; contact details are masked" },
      { key: P.CUSTOMER_PII_VIEW, label: "View diner PII", description: "See unmasked phone, email and address", sensitive: true },
      { key: P.ORDER_VIEW, label: "View orders", description: "Search and inspect orders" },
      { key: P.ORDER_UPDATE, label: "Update orders", description: "Change order state where permitted", sensitive: true },
      { key: P.TRANSACTION_VIEW, label: "View transactions", description: "Inspect a restaurant's payments" },
    ],
  },
  {
    key: "support",
    label: "Support",
    permissions: [
      { key: P.TICKET_VIEW, label: "View tickets", description: "See support tickets" },
      { key: P.TICKET_CREATE, label: "Create tickets", description: "Raise a support ticket" },
      { key: P.TICKET_ASSIGN, label: "Assign tickets", description: "Assign a ticket to an employee" },
      { key: P.TICKET_UPDATE, label: "Update tickets", description: "Comment on and progress tickets" },
      { key: P.TICKET_ESCALATE, label: "Escalate to engineering", description: "Escalate a ticket and create a Jira issue" },
      { key: P.TICKET_ATTACHMENT_MANAGE, label: "Manage ticket attachments", description: "Upload and remove files on a ticket" },
    ],
  },
  {
    key: "sales",
    label: "Sales",
    permissions: [
      { key: P.OPPORTUNITY_VIEW, label: "View opportunities", description: "See the sales pipeline" },
      { key: P.OPPORTUNITY_MANAGE, label: "Manage opportunities", description: "Create, advance and close deals" },
    ],
  },
  {
    key: "analytics",
    label: "Analytics & reports",
    permissions: [
      { key: P.ANALYTICS_VIEW, label: "View analytics", description: "Customer, product and subscription analytics" },
      { key: P.ANALYTICS_FINANCIAL_VIEW, label: "View revenue analytics", description: "MRR, ARR and revenue figures", sensitive: true },
      { key: P.REPORT_VIEW, label: "View reports", description: "Open generated reports" },
      { key: P.REPORT_EXPORT, label: "Export reports", description: "Download report data", sensitive: true },
    ],
  },
  {
    key: "engineering",
    label: "Engineering",
    permissions: [
      { key: P.ENGINEERING_ISSUE_VIEW, label: "View engineering issues", description: "Escalated tickets and their Jira issues" },
      { key: P.SYSTEM_HEALTH_VIEW, label: "View system health", description: "Service and integration health" },
      { key: P.LOG_VIEW, label: "View application logs", description: "Search application logs", sensitive: true },
    ],
  },
  {
    key: "administration",
    label: "Administration",
    permissions: [
      { key: P.EMPLOYEE_VIEW, label: "View employees", description: "See internal employee records" },
      { key: P.EMPLOYEE_CREATE, label: "Create employees", description: "Add an internal employee", sensitive: true },
      { key: P.EMPLOYEE_UPDATE, label: "Update employees", description: "Edit employee details and roles", sensitive: true },
      { key: P.EMPLOYEE_DISABLE, label: "Disable employees", description: "Revoke an employee's access", sensitive: true },
      { key: P.ROLE_VIEW, label: "View roles", description: "See roles and their permissions" },
      { key: P.ROLE_MANAGE, label: "Manage roles", description: "Create roles and change permissions", sensitive: true },
      { key: P.AUDIT_VIEW, label: "View audit logs", description: "Read the audit trail" },
    ],
  },
];

const assertCatalogComplete = () => {
  const grouped = new Set(PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key)));
  const missing = ALL_PERMISSIONS.filter((p) => !grouped.has(p));
  if (missing.length) {
    throw new Error(`Permission catalog incomplete — not in any group: ${missing.join(", ")}`);
  }
  const overlap = ALL_PERMISSIONS.filter((p) => RETIRED_PERMISSIONS.includes(p));
  if (overlap.length) {
    throw new Error(`Permission is both live and retired: ${overlap.join(", ")}`);
  }
};
assertCatalogComplete();

/** The set of permissions marked sensitive, for 2FA and review policies. */
export const SENSITIVE_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((group) =>
  group.permissions.filter((p) => p.sensitive).map((p) => p.key),
);

/**
 * How much of the customer base a role can reach.
 *
 * Permissions say what someone may do; scope says to whom. Splitting them is
 * what makes "Support may read customers" mean "the customers they are assigned
 * to" rather than "every customer DineInk has" — previously the two were the
 * same statement and every employee saw everything.
 */
export type AccountScope = "ALL_ACCOUNTS" | "ASSIGNED_ACCOUNTS";

export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
  /**
   * The scope this role is seeded with. Administrators can change it per role
   * afterwards; it is not derived from the permission list because "may read
   * every customer" is a deliberate decision, not a side effect of one.
   */
  scope: AccountScope;
}

/**
 * The initial roles. `permissions` here is the *seed* — an authorized
 * administrator can change any role's permissions afterwards through the admin
 * UI, and the seeder never overwrites a role that already exists.
 *
 * Shaped around the job, not around the data: Support can read a customer and
 * own its tickets but cannot change what that customer pays; Finance owns
 * billing but not engineering; Engineering gets technical context but neither
 * diner PII nor billing.
 */
export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: "SUPER_ADMIN",
    name: "Super Admin",
    description: "Full access to every module. Every sensitive action is still audited.",
    permissions: ALL_PERMISSIONS,
    scope: "ALL_ACCOUNTS",
  },
  {
    key: "OPERATIONS",
    name: "Operations",
    description:
      "Runs day-to-day customer operations, onboarding and support across the whole customer base. No billing administration and no employee-permission administration.",
    permissions: [
      P.ACCOUNT_VIEW, P.ACCOUNT_CREATE, P.ACCOUNT_EDIT, P.ACCOUNT_LIFECYCLE_MANAGE,
      P.ACCOUNT_CONTACT_VIEW, P.ACCOUNT_CONTACT_MANAGE, P.ACCOUNT_ASSIGNMENT_MANAGE,
      P.PRODUCT_VIEW, P.PLAN_VIEW,
      P.SUBSCRIPTION_VIEW,
      P.INVOICE_VIEW,
      P.LOCATION_VIEW, P.LOCATION_MANAGE,
      P.RESTAURANT_VIEW, P.RESTAURANT_CREATE, P.RESTAURANT_EDIT,
      P.RESTAURANT_ACTIVATE, P.RESTAURANT_SUSPEND,
      P.RESTAURANT_USER_VIEW, P.RESTAURANT_USER_MANAGE,
      P.RESTAURANT_MENU_VIEW, P.RESTAURANT_TABLE_VIEW, P.RESTAURANT_TABLE_MANAGE,
      P.ONBOARDING_VIEW, P.ONBOARDING_MANAGE, P.ONBOARDING_GO_LIVE,
      P.CUSTOMER_VIEW, P.ORDER_VIEW, P.TRANSACTION_VIEW,
      P.TICKET_VIEW, P.TICKET_CREATE, P.TICKET_ASSIGN, P.TICKET_UPDATE,
      P.TICKET_ESCALATE, P.TICKET_ATTACHMENT_MANAGE,
      P.ANALYTICS_VIEW, P.REPORT_VIEW,
    ],
    scope: "ALL_ACCOUNTS",
  },
  {
    key: "CUSTOMER_SUCCESS",
    name: "Customer Success / Onboarding",
    description:
      "Drives assigned customers from signed to live and helps them stay set up. Sees only the customers they are assigned to.",
    permissions: [
      P.ACCOUNT_VIEW, P.ACCOUNT_EDIT, P.ACCOUNT_CONTACT_VIEW, P.ACCOUNT_CONTACT_MANAGE,
      P.PRODUCT_VIEW, P.PLAN_VIEW, P.SUBSCRIPTION_VIEW,
      P.LOCATION_VIEW, P.LOCATION_MANAGE,
      P.RESTAURANT_VIEW, P.RESTAURANT_EDIT,
      P.RESTAURANT_USER_VIEW, P.RESTAURANT_USER_MANAGE,
      P.RESTAURANT_MENU_VIEW, P.RESTAURANT_TABLE_VIEW, P.RESTAURANT_TABLE_MANAGE,
      P.ONBOARDING_VIEW, P.ONBOARDING_MANAGE, P.ONBOARDING_GO_LIVE,
      P.ORDER_VIEW,
      P.TICKET_VIEW, P.TICKET_CREATE, P.TICKET_UPDATE, P.TICKET_ATTACHMENT_MANAGE,
      P.ANALYTICS_VIEW,
    ],
    scope: "ASSIGNED_ACCOUNTS",
  },
  {
    key: "SUPPORT",
    name: "Support",
    description:
      "Investigates what customers report and escalates genuine technical faults. Reads customers and their systems; changes neither their configuration nor their billing. Diner contact details stay masked.",
    permissions: [
      P.ACCOUNT_VIEW, P.ACCOUNT_CONTACT_VIEW,
      P.PRODUCT_VIEW, P.PLAN_VIEW,
      // Deliberately view-only: an agent must be able to answer "what did they
      // buy and is it paid" without being able to change either.
      P.SUBSCRIPTION_VIEW, P.INVOICE_VIEW,
      P.LOCATION_VIEW,
      P.RESTAURANT_VIEW, P.RESTAURANT_USER_VIEW,
      P.RESTAURANT_MENU_VIEW, P.RESTAURANT_TABLE_VIEW,
      P.ONBOARDING_VIEW,
      P.CUSTOMER_VIEW, P.ORDER_VIEW, P.TRANSACTION_VIEW,
      P.TICKET_VIEW, P.TICKET_CREATE, P.TICKET_ASSIGN, P.TICKET_UPDATE,
      P.TICKET_ESCALATE, P.TICKET_ATTACHMENT_MANAGE,
    ],
    scope: "ALL_ACCOUNTS",
  },
  {
    key: "FINANCE",
    name: "Finance",
    description:
      "Owns invoicing, payments, credit notes, plan pricing and revenue reporting. No engineering administration and no customer system configuration.",
    permissions: [
      P.ACCOUNT_VIEW, P.ACCOUNT_CONTACT_VIEW, P.ACCOUNT_FINANCIAL_VIEW,
      P.PRODUCT_VIEW, P.PLAN_VIEW, P.PLAN_PRICING_MANAGE,
      P.SUBSCRIPTION_VIEW, P.SUBSCRIPTION_EDIT, P.SUBSCRIPTION_LIFECYCLE_MANAGE,
      P.INVOICE_VIEW, P.INVOICE_CREATE, P.INVOICE_EDIT, P.INVOICE_ISSUE, P.INVOICE_VOID,
      P.PAYMENT_VIEW, P.PAYMENT_RECORD,
      P.CREDIT_NOTE_VIEW, P.CREDIT_NOTE_ISSUE,
      P.LOCATION_VIEW,
      P.RESTAURANT_VIEW, P.RESTAURANT_FINANCIAL_VIEW,
      P.ORDER_VIEW, P.TRANSACTION_VIEW,
      P.ANALYTICS_VIEW, P.ANALYTICS_FINANCIAL_VIEW, P.REPORT_VIEW, P.REPORT_EXPORT,
      P.TICKET_VIEW, P.TICKET_CREATE, P.TICKET_UPDATE,
    ],
    scope: "ALL_ACCOUNTS",
  },
  {
    key: "SALES",
    name: "Sales",
    description:
      "Works leads, prospects and deals through to a signed subscription. No billing administration and no diner data.",
    permissions: [
      P.ACCOUNT_VIEW, P.ACCOUNT_CREATE, P.ACCOUNT_EDIT, P.ACCOUNT_LIFECYCLE_MANAGE,
      P.ACCOUNT_CONTACT_VIEW, P.ACCOUNT_CONTACT_MANAGE,
      P.PRODUCT_VIEW, P.PLAN_VIEW,
      P.SUBSCRIPTION_VIEW, P.SUBSCRIPTION_CREATE,
      P.LOCATION_VIEW,
      P.OPPORTUNITY_VIEW, P.OPPORTUNITY_MANAGE,
      P.ONBOARDING_VIEW,
      P.ANALYTICS_VIEW,
      P.TICKET_VIEW, P.TICKET_CREATE,
    ],
    scope: "ALL_ACCOUNTS",
  },
  {
    key: "ENGINEERING",
    name: "Developer / Engineering",
    description:
      "Investigates escalated issues with full technical context and links them to Jira. Deliberately excludes diner PII and all billing administration.",
    permissions: [
      P.ACCOUNT_VIEW,
      P.PRODUCT_VIEW,
      P.LOCATION_VIEW,
      P.RESTAURANT_VIEW, P.RESTAURANT_TABLE_VIEW, P.RESTAURANT_MENU_VIEW,
      P.ORDER_VIEW, P.TRANSACTION_VIEW,
      P.TICKET_VIEW, P.TICKET_CREATE, P.TICKET_UPDATE, P.TICKET_ASSIGN,
      P.TICKET_ESCALATE, P.TICKET_ATTACHMENT_MANAGE,
      P.ENGINEERING_ISSUE_VIEW, P.SYSTEM_HEALTH_VIEW, P.LOG_VIEW,
    ],
    scope: "ALL_ACCOUNTS",
  },
  {
    key: "ANALYST",
    name: "Analyst",
    description: "Read-only analytics and reporting, working from aggregates rather than row-level diner records.",
    permissions: [
      P.ACCOUNT_VIEW,
      P.PRODUCT_VIEW, P.PLAN_VIEW, P.SUBSCRIPTION_VIEW, P.INVOICE_VIEW,
      P.LOCATION_VIEW, P.RESTAURANT_VIEW, P.ORDER_VIEW,
      P.OPPORTUNITY_VIEW,
      P.ONBOARDING_VIEW,
      P.ANALYTICS_VIEW, P.ANALYTICS_FINANCIAL_VIEW, P.REPORT_VIEW,
    ],
    scope: "ALL_ACCOUNTS",
  },
];

export default PERMISSIONS;
