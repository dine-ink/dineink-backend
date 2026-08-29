/**
 * The permission catalog for the DineInk internal application.
 *
 * This file — not the database — is the source of truth for which permissions
 * exist. InternalRolePermission stores plain strings, so if the catalog lived in
 * the database a typo would create a permission that no route ever checks: it
 * would look granted in the admin UI and deny nothing. Keeping the list in code
 * means `requirePermission(P.RESTAURANT_SUSPEND)` fails to compile if the
 * permission is misspelled, and the roles screen can only offer real ones.
 *
 * Authorization is checked against permissions, never role names. A role is just
 * a bundle; renaming "Operations Admin" or adding a ninth role must never
 * require touching a route.
 */

export const PERMISSIONS = {
  // Restaurants
  RESTAURANT_VIEW: "RESTAURANT_VIEW",
  RESTAURANT_CREATE: "RESTAURANT_CREATE",
  RESTAURANT_EDIT: "RESTAURANT_EDIT",
  RESTAURANT_ACTIVATE: "RESTAURANT_ACTIVATE",
  RESTAURANT_SUSPEND: "RESTAURANT_SUSPEND",
  RESTAURANT_ONBOARDING_MANAGE: "RESTAURANT_ONBOARDING_MANAGE",
  RESTAURANT_USER_VIEW: "RESTAURANT_USER_VIEW",
  RESTAURANT_USER_MANAGE: "RESTAURANT_USER_MANAGE",
  RESTAURANT_MENU_VIEW: "RESTAURANT_MENU_VIEW",
  RESTAURANT_MENU_EDIT: "RESTAURANT_MENU_EDIT",
  RESTAURANT_TABLE_VIEW: "RESTAURANT_TABLE_VIEW",
  RESTAURANT_TABLE_MANAGE: "RESTAURANT_TABLE_MANAGE",
  // Financial/business fields on a restaurant (GST, bank, agreement) are a
  // tighter grant than ordinary business information.
  RESTAURANT_FINANCIAL_VIEW: "RESTAURANT_FINANCIAL_VIEW",

  // Customers
  CUSTOMER_VIEW: "CUSTOMER_VIEW",
  // Unmasked phone/email/address. CUSTOMER_VIEW alone shows masked values.
  CUSTOMER_PII_VIEW: "CUSTOMER_PII_VIEW",

  // Orders
  ORDER_VIEW: "ORDER_VIEW",
  ORDER_UPDATE: "ORDER_UPDATE",

  // Transactions / money
  TRANSACTION_VIEW: "TRANSACTION_VIEW",

  // Support
  TICKET_VIEW: "TICKET_VIEW",
  TICKET_CREATE: "TICKET_CREATE",
  TICKET_ASSIGN: "TICKET_ASSIGN",
  TICKET_UPDATE: "TICKET_UPDATE",
  TICKET_ESCALATE: "TICKET_ESCALATE",

  // Analytics & reporting
  ANALYTICS_VIEW: "ANALYTICS_VIEW",
  ANALYTICS_FINANCIAL_VIEW: "ANALYTICS_FINANCIAL_VIEW",
  REPORT_VIEW: "REPORT_VIEW",
  // Export is separate from view on purpose: reading one restaurant's numbers
  // on screen is not the same risk as walking out with the whole customer base
  // as a spreadsheet.
  REPORT_EXPORT: "REPORT_EXPORT",

  // Engineering
  ENGINEERING_ISSUE_VIEW: "ENGINEERING_ISSUE_VIEW",
  SYSTEM_HEALTH_VIEW: "SYSTEM_HEALTH_VIEW",
  LOG_VIEW: "LOG_VIEW",

  // Administration
  EMPLOYEE_VIEW: "EMPLOYEE_VIEW",
  EMPLOYEE_CREATE: "EMPLOYEE_CREATE",
  EMPLOYEE_UPDATE: "EMPLOYEE_UPDATE",
  EMPLOYEE_DISABLE: "EMPLOYEE_DISABLE",
  ROLE_VIEW: "ROLE_VIEW",
  ROLE_MANAGE: "ROLE_MANAGE",
  AUDIT_VIEW: "AUDIT_VIEW",
  NOTIFICATION_VIEW: "NOTIFICATION_VIEW",
  NOTIFICATION_MANAGE: "NOTIFICATION_MANAGE",

  // Settings
  SETTINGS_VIEW: "SETTINGS_VIEW",
  SETTINGS_MANAGE: "SETTINGS_MANAGE",
  FEATURE_FLAG_MANAGE: "FEATURE_FLAG_MANAGE",

} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

export const isPermission = (value: string): value is Permission =>
  (ALL_PERMISSIONS as string[]).includes(value);

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
    key: "restaurants",
    label: "Restaurants",
    permissions: [
      { key: P.RESTAURANT_VIEW, label: "View restaurants", description: "Search and open restaurant records" },
      { key: P.RESTAURANT_CREATE, label: "Create restaurants", description: "Add a new restaurant or lead" },
      { key: P.RESTAURANT_EDIT, label: "Edit restaurants", description: "Update business information" },
      { key: P.RESTAURANT_ACTIVATE, label: "Activate restaurants", description: "Take a restaurant live", sensitive: true },
      { key: P.RESTAURANT_SUSPEND, label: "Suspend restaurants", description: "Suspend a live restaurant", sensitive: true },
      { key: P.RESTAURANT_ONBOARDING_MANAGE, label: "Manage onboarding", description: "Advance stages and complete checklist items" },
      { key: P.RESTAURANT_USER_VIEW, label: "View restaurant users", description: "See a restaurant's own staff accounts" },
      { key: P.RESTAURANT_USER_MANAGE, label: "Manage restaurant users", description: "Create, disable and reset restaurant staff access", sensitive: true },
      { key: P.RESTAURANT_MENU_VIEW, label: "View menu", description: "Inspect a restaurant's menu" },
      { key: P.RESTAURANT_MENU_EDIT, label: "Edit menu", description: "Modify a restaurant's own menu data", sensitive: true },
      { key: P.RESTAURANT_TABLE_VIEW, label: "View tables & QR", description: "See tables and QR status" },
      { key: P.RESTAURANT_TABLE_MANAGE, label: "Manage tables & QR", description: "Generate, regenerate and disable QR codes", sensitive: true },
      { key: P.RESTAURANT_FINANCIAL_VIEW, label: "View restaurant financial details", description: "GST, bank and agreement information", sensitive: true },
    ],
  },
  {
    key: "customers",
    label: "Customers",
    permissions: [
      { key: P.CUSTOMER_VIEW, label: "View customers", description: "Search customers; contact details are masked" },
      { key: P.CUSTOMER_PII_VIEW, label: "View customer PII", description: "See unmasked phone, email and address", sensitive: true },
    ],
  },
  {
    key: "orders",
    label: "Orders & transactions",
    permissions: [
      { key: P.ORDER_VIEW, label: "View orders", description: "Search and inspect orders" },
      { key: P.ORDER_UPDATE, label: "Update orders", description: "Change order state where permitted", sensitive: true },
      { key: P.TRANSACTION_VIEW, label: "View transactions", description: "Inspect payments and refunds" },
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
    ],
  },
  {
    key: "analytics",
    label: "Analytics & reports",
    permissions: [
      { key: P.ANALYTICS_VIEW, label: "View analytics", description: "Operational and growth analytics" },
      { key: P.ANALYTICS_FINANCIAL_VIEW, label: "View financial analytics", description: "GMV, revenue and margin figures", sensitive: true },
      { key: P.REPORT_VIEW, label: "View reports", description: "Open generated reports" },
      { key: P.REPORT_EXPORT, label: "Export reports", description: "Download report data", sensitive: true },
    ],
  },
  {
    key: "engineering",
    label: "Engineering",
    permissions: [
      { key: P.ENGINEERING_ISSUE_VIEW, label: "View engineering issues", description: "Escalated tickets and their Jira issues" },
      { key: P.SYSTEM_HEALTH_VIEW, label: "View system health", description: "Service health and error rates" },
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
      { key: P.NOTIFICATION_VIEW, label: "View notifications", description: "See internal notifications" },
      { key: P.NOTIFICATION_MANAGE, label: "Manage notifications", description: "Configure notification rules", sensitive: true },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    permissions: [
      { key: P.SETTINGS_VIEW, label: "View settings", description: "See platform configuration" },
      { key: P.SETTINGS_MANAGE, label: "Manage settings", description: "Change platform configuration", sensitive: true },
      { key: P.FEATURE_FLAG_MANAGE, label: "Manage feature flags", description: "Turn features on and off", sensitive: true },
    ],
  },
];

const assertCatalogComplete = () => {
  const grouped = new Set(PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key)));
  const missing = ALL_PERMISSIONS.filter((p) => !grouped.has(p));
  if (missing.length) {
    throw new Error(`Permission catalog incomplete — not in any group: ${missing.join(", ")}`);
  }
};
assertCatalogComplete();

/**
 * The initial roles. `permissions` here is the *seed* — an authorized
 * administrator can change any role's permissions afterwards through the admin
 * UI, and the seeder never overwrites a role that already exists.
 *
 * Two deliberate restrictions, both from the brief:
 *   - Engineering roles get technical context but not customer PII or money.
 *   - Analyst is read-only and prefers aggregates over row-level customer data.
 */
export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
}

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: "SUPER_ADMIN",
    name: "Super Admin",
    description: "Full access to every module. Every sensitive action is still audited.",
    permissions: ALL_PERMISSIONS,
  },
  {
    key: "OPERATIONS_ADMIN",
    name: "Operations Admin",
    description:
      "Runs day-to-day restaurant operations and support. No employee-permission administration, security settings, or unrestricted financial administration.",
    permissions: [
      P.RESTAURANT_VIEW, P.RESTAURANT_CREATE, P.RESTAURANT_EDIT, P.RESTAURANT_ACTIVATE, P.RESTAURANT_SUSPEND,
      P.RESTAURANT_ONBOARDING_MANAGE, P.RESTAURANT_USER_VIEW, P.RESTAURANT_USER_MANAGE,
      P.RESTAURANT_MENU_VIEW, P.RESTAURANT_TABLE_VIEW, P.RESTAURANT_TABLE_MANAGE,
      P.CUSTOMER_VIEW,
      P.ORDER_VIEW, P.TRANSACTION_VIEW,
      P.TICKET_VIEW, P.TICKET_CREATE, P.TICKET_ASSIGN, P.TICKET_UPDATE, P.TICKET_ESCALATE,
      P.ANALYTICS_VIEW, P.REPORT_VIEW,
      P.NOTIFICATION_VIEW,
      P.SETTINGS_VIEW,
    ],
  },
  {
    key: "RESTAURANT_SUCCESS",
    name: "Restaurant Success / Onboarding",
    description: "Creates restaurant records, drives onboarding to activation, and helps restaurants get set up.",
    permissions: [
      P.RESTAURANT_VIEW, P.RESTAURANT_CREATE, P.RESTAURANT_EDIT, P.RESTAURANT_ONBOARDING_MANAGE,
      P.RESTAURANT_USER_VIEW, P.RESTAURANT_USER_MANAGE,
      P.RESTAURANT_MENU_VIEW, P.RESTAURANT_MENU_EDIT,
      P.RESTAURANT_TABLE_VIEW, P.RESTAURANT_TABLE_MANAGE,
      P.ORDER_VIEW,
      P.TICKET_VIEW, P.TICKET_CREATE, P.TICKET_UPDATE,
      P.ANALYTICS_VIEW,
    ],
  },
  {
    key: "SUPPORT",
    name: "Support",
    description:
      "Searches restaurants, customers, orders and transactions to investigate reported issues, and escalates genuine technical problems. Customer contact details stay masked.",
    permissions: [
      P.RESTAURANT_VIEW, P.RESTAURANT_USER_VIEW, P.RESTAURANT_MENU_VIEW, P.RESTAURANT_TABLE_VIEW,
      P.CUSTOMER_VIEW,
      P.ORDER_VIEW, P.TRANSACTION_VIEW,
      P.TICKET_VIEW, P.TICKET_CREATE, P.TICKET_ASSIGN, P.TICKET_UPDATE, P.TICKET_ESCALATE,
      P.NOTIFICATION_VIEW,
    ],
  },
  {
    key: "FINANCE",
    name: "Finance",
    description: "Owns transactions, refund approvals, settlements and financial reporting.",
    permissions: [
      P.RESTAURANT_VIEW, P.RESTAURANT_FINANCIAL_VIEW,
      P.ORDER_VIEW, P.TRANSACTION_VIEW,
      P.ANALYTICS_VIEW, P.ANALYTICS_FINANCIAL_VIEW, P.REPORT_VIEW, P.REPORT_EXPORT,
      P.TICKET_VIEW, P.TICKET_CREATE, P.TICKET_UPDATE,
      P.NOTIFICATION_VIEW,
    ],
  },
  {
    key: "SALES",
    name: "Sales",
    description: "Works restaurant leads and onboarding status. No customer contact data and no financial administration.",
    permissions: [
      P.RESTAURANT_VIEW, P.RESTAURANT_CREATE, P.RESTAURANT_EDIT, P.RESTAURANT_ONBOARDING_MANAGE,
      P.ANALYTICS_VIEW,
      P.TICKET_VIEW, P.TICKET_CREATE,
    ],
  },
  {
    key: "ENGINEERING",
    name: "Developer / Engineering",
    description:
      "Investigates escalated issues with full technical context and links them to Jira. Deliberately excludes customer PII and financial administration.",
    permissions: [
      P.RESTAURANT_VIEW, P.RESTAURANT_TABLE_VIEW, P.RESTAURANT_MENU_VIEW,
      P.ORDER_VIEW, P.TRANSACTION_VIEW,
      P.TICKET_VIEW, P.TICKET_CREATE, P.TICKET_UPDATE, P.TICKET_ASSIGN, P.TICKET_ESCALATE,
      P.ENGINEERING_ISSUE_VIEW, P.SYSTEM_HEALTH_VIEW, P.LOG_VIEW,
      P.NOTIFICATION_VIEW,
    ],
  },
  {
    key: "ANALYST",
    name: "Analyst",
    description: "Read-only analytics and reporting, working from aggregates rather than row-level customer records.",
    permissions: [
      P.RESTAURANT_VIEW,
      P.ORDER_VIEW,
      P.ANALYTICS_VIEW, P.ANALYTICS_FINANCIAL_VIEW, P.REPORT_VIEW,
    ],
  },
];

export default PERMISSIONS;
