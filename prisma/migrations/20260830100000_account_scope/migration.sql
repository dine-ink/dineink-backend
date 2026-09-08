-- Account scoping for roles.
--
-- Permissions answer "what may this employee do". This answers "to which
-- customers". Previously there was no second question: ACCOUNT_VIEW (then
-- RESTAURANT_VIEW) meant every customer on the platform, which is the single
-- largest authorization gap the console had.
--
-- The column defaults to ASSIGNED_ACCOUNTS — the narrower of the two — so a
-- role an administrator invents later starts unable to see the whole book
-- rather than able to. The seeded roles that genuinely need platform-wide
-- reach are widened explicitly below.

CREATE TYPE "AccountScope" AS ENUM ('ALL_ACCOUNTS', 'ASSIGNED_ACCOUNTS');

ALTER TABLE "InternalRole"
    ADD COLUMN "accountScope" "AccountScope" NOT NULL DEFAULT 'ASSIGNED_ACCOUNTS';

-- Existing roles keep the reach they already had, so this migration changes no
-- one's access on the day it runs. Narrowing a role is a deliberate decision
-- made in the Roles screen afterwards, not a surprise from a deploy.
--
-- Customer Success is the exception: it is defined by the accounts it is given,
-- so it starts assigned-only. It is also a role nobody holds yet.
-- Matches on both names deliberately. The rename from RESTAURANT_SUCCESS to
-- CUSTOMER_SUCCESS happens further down this file, so at this point the role
-- still carries its old key — excluding only the new name would miss it and
-- hand the role platform-wide reach, which is the opposite of the intent.
UPDATE "InternalRole" SET "accountScope" = 'ALL_ACCOUNTS'
WHERE "key" NOT IN ('CUSTOMER_SUCCESS', 'RESTAURANT_SUCCESS');

-- Remove grants for permissions that no longer exist. Leaving them would put
-- rows in InternalRolePermission that no route checks — they would read as
-- granted in the admin UI and deny nothing, which is exactly the failure the
-- code-defined catalog exists to prevent.
DELETE FROM "InternalRolePermission"
WHERE "permission" IN (
    'REFUND_VIEW', 'REFUND_APPROVE', 'REFUND_REJECT',
    'SETTLEMENT_VIEW', 'SETTLEMENT_MANAGE',
    'FEATURE_FLAG_MANAGE',
    'SETTINGS_VIEW', 'SETTINGS_MANAGE',
    'NOTIFICATION_VIEW', 'NOTIFICATION_MANAGE',
    'RESTAURANT_ONBOARDING_MANAGE',
    'COPILOT_USE'
);

-- Carry the old restaurant-scoped grants onto their account-scoped successors,
-- so nobody loses access they were relying on this morning.
INSERT INTO "InternalRolePermission" ("roleId", "permission")
SELECT DISTINCT rp."roleId", v.permission
FROM "InternalRolePermission" rp
CROSS JOIN (VALUES ('ACCOUNT_VIEW'), ('ONBOARDING_VIEW')) AS v(permission)
WHERE rp."permission" = 'RESTAURANT_VIEW'
ON CONFLICT ("roleId", "permission") DO NOTHING;

INSERT INTO "InternalRolePermission" ("roleId", "permission")
SELECT DISTINCT rp."roleId", v.permission
FROM "InternalRolePermission" rp
CROSS JOIN (VALUES ('ACCOUNT_CREATE'), ('ACCOUNT_EDIT')) AS v(permission)
WHERE rp."permission" = 'RESTAURANT_CREATE'
ON CONFLICT ("roleId", "permission") DO NOTHING;

INSERT INTO "InternalRolePermission" ("roleId", "permission")
SELECT DISTINCT rp."roleId", 'ONBOARDING_MANAGE'
FROM "InternalRolePermission" rp
WHERE rp."permission" = 'RESTAURANT_ACTIVATE'
ON CONFLICT ("roleId", "permission") DO NOTHING;

INSERT INTO "InternalRolePermission" ("roleId", "permission")
SELECT DISTINCT rp."roleId", 'ONBOARDING_GO_LIVE'
FROM "InternalRolePermission" rp
WHERE rp."permission" = 'RESTAURANT_ACTIVATE'
ON CONFLICT ("roleId", "permission") DO NOTHING;

-- Anyone who could see the old contact information keeps an equivalent view of
-- the new account contacts.
INSERT INTO "InternalRolePermission" ("roleId", "permission")
SELECT DISTINCT rp."roleId", 'ACCOUNT_CONTACT_VIEW'
FROM "InternalRolePermission" rp
WHERE rp."permission" = 'RESTAURANT_USER_VIEW'
ON CONFLICT ("roleId", "permission") DO NOTHING;

-- The product catalogue is reference data; anyone who could open a restaurant
-- can see which products exist.
INSERT INTO "InternalRolePermission" ("roleId", "permission")
SELECT DISTINCT rp."roleId", v.permission
FROM "InternalRolePermission" rp
CROSS JOIN (VALUES ('PRODUCT_VIEW'), ('PLAN_VIEW'), ('LOCATION_VIEW')) AS v(permission)
WHERE rp."permission" = 'RESTAURANT_VIEW'
ON CONFLICT ("roleId", "permission") DO NOTHING;

-- Super Admin holds everything by definition, including the permissions this
-- release introduced.
INSERT INTO "InternalRolePermission" ("roleId", "permission")
SELECT r."id", v.permission
FROM "InternalRole" r
CROSS JOIN (VALUES
    ('ACCOUNT_VIEW'), ('ACCOUNT_CREATE'), ('ACCOUNT_EDIT'), ('ACCOUNT_LIFECYCLE_MANAGE'),
    ('ACCOUNT_CONTACT_VIEW'), ('ACCOUNT_CONTACT_MANAGE'), ('ACCOUNT_ASSIGNMENT_MANAGE'),
    ('ACCOUNT_FINANCIAL_VIEW'),
    ('PRODUCT_VIEW'), ('PRODUCT_MANAGE'), ('PLAN_VIEW'), ('PLAN_MANAGE'), ('PLAN_PRICING_MANAGE'),
    ('SUBSCRIPTION_VIEW'), ('SUBSCRIPTION_CREATE'), ('SUBSCRIPTION_EDIT'), ('SUBSCRIPTION_LIFECYCLE_MANAGE'),
    ('INVOICE_VIEW'), ('INVOICE_CREATE'), ('INVOICE_EDIT'), ('INVOICE_ISSUE'), ('INVOICE_VOID'),
    ('PAYMENT_VIEW'), ('PAYMENT_RECORD'), ('CREDIT_NOTE_VIEW'), ('CREDIT_NOTE_ISSUE'),
    ('LOCATION_VIEW'), ('LOCATION_MANAGE'),
    ('ONBOARDING_VIEW'), ('ONBOARDING_MANAGE'), ('ONBOARDING_GO_LIVE'),
    ('OPPORTUNITY_VIEW'), ('OPPORTUNITY_MANAGE'),
    ('TICKET_ATTACHMENT_MANAGE')
) AS v(permission)
WHERE r."key" = 'SUPER_ADMIN'
ON CONFLICT ("roleId", "permission") DO NOTHING;

-- The seeded role renamed from OPERATIONS_ADMIN to OPERATIONS, and from
-- RESTAURANT_SUCCESS to CUSTOMER_SUCCESS, because the console is no longer
-- organised around restaurants.
UPDATE "InternalRole" SET "key" = 'OPERATIONS', "name" = 'Operations'
WHERE "key" = 'OPERATIONS_ADMIN'
  AND NOT EXISTS (SELECT 1 FROM "InternalRole" WHERE "key" = 'OPERATIONS');

UPDATE "InternalRole" SET "key" = 'CUSTOMER_SUCCESS', "name" = 'Customer Success / Onboarding'
WHERE "key" = 'RESTAURANT_SUCCESS'
  AND NOT EXISTS (SELECT 1 FROM "InternalRole" WHERE "key" = 'CUSTOMER_SUCCESS');

-- No AccountAssignment rows are created here. Nothing in the current data
-- records which employee looks after which customer, and inventing that mapping
-- would either hand someone access they were never given or silently take it
-- away. Every seeded role except Customer Success keeps ALL_ACCOUNTS scope, so
-- access is unchanged today; assignments get filled in from the Customers
-- screen as Dineink decides who owns what.
