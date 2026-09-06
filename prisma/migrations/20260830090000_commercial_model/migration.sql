-- DineInk commercial model.
--
-- Introduces the entity that was missing from the whole system: the Account
-- that actually buys the software. Restaurant becomes a product tenant owned by
-- an Account rather than standing in for the customer, and the four lifecycles
-- that had been collapsed into Restaurant.platformStatus get their own columns
-- on their own tables:
--
--   Account.status           commercial   LEAD / PROSPECT / CUSTOMER / CHURNED
--   Onboarding.status        delivery     NOT_STARTED ... COMPLETED
--   Subscription.status      billing      TRIAL / ACTIVE / PAST_DUE / ...
--   Branch.operationalStatus trading      ACTIVE / INACTIVE / CLOSED
--
-- Purely additive. Nothing is dropped or renamed: Restaurant.platformStatus and
-- RestaurantOnboardingTask are left in place and still readable so the cutover
-- can be verified against them before either is retired.
--
-- NOTE: `prisma migrate diff` also wanted to drop RestaurantInsights.
-- capitalEmployed / .propertyValue and RunningOrder.orderStatus, and to
-- recreate seven *_branchId_fkey constraints. That is pre-existing drift
-- between schema.prisma and the production database, unrelated to this change,
-- and has been removed from this file by hand. It still needs reconciling
-- separately.

-- CreateEnum
CREATE TYPE "LocationOperationalStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "AccountLifecycleStatus" AS ENUM ('LEAD', 'PROSPECT', 'CUSTOMER', 'CHURNED');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CreditNoteStatus" AS ENUM ('ISSUED', 'APPLIED', 'VOID');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'READY_FOR_GO_LIVE', 'LIVE', 'COMPLETED');

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "operationalStatus" "LocationOperationalStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "Restaurant" ADD COLUMN     "accountId" INTEGER;

-- AlterTable
ALTER TABLE "SupportTicket" ADD COLUMN     "accountId" INTEGER,
ADD COLUMN     "productId" INTEGER;

-- CreateTable
CREATE TABLE "Account" (
    "id" SERIAL NOT NULL,
    "accountCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "status" "AccountLifecycleStatus" NOT NULL DEFAULT 'LEAD',
    "salesStageKey" TEXT,
    "ownerId" INTEGER,
    "gstNumber" TEXT,
    "billingEmail" TEXT,
    "billingPhone" TEXT,
    "billingAddress" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "website" TEXT,
    "industrySegment" TEXT,
    "notes" TEXT,
    "becameCustomerAt" TIMESTAMP(3),
    "churnedAt" TIMESTAMP(3),
    "churnReason" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountContact" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "designation" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountAssignment" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "role" TEXT,
    "grantedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "targetSegment" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "priceAmount" DECIMAL(12,2),
    "currency" TEXT,
    "billingInterval" "BillingInterval",
    "trialDays" INTEGER,
    "includedLocations" INTEGER,
    "includedSeats" INTEGER,
    "entitlementNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" SERIAL NOT NULL,
    "subscriptionCode" TEXT NOT NULL,
    "accountId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "planId" INTEGER,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "startDate" TIMESTAMP(3) NOT NULL,
    "billingInterval" "BillingInterval",
    "trialEndsAt" TIMESTAMP(3),
    "renewalDate" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "seats" INTEGER,
    "locations" INTEGER,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "endedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionEvent" (
    "id" SERIAL NOT NULL,
    "subscriptionId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "message" TEXT,
    "actorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" SERIAL NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "accountId" INTEGER NOT NULL,
    "subscriptionId" INTEGER,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(12,2),
    "taxNotes" TEXT,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "notes" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "subscriptionId" INTEGER,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1,
    "unitAmount" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "paymentNo" TEXT NOT NULL,
    "accountId" INTEGER NOT NULL,
    "invoiceId" INTEGER,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'SUCCEEDED',
    "method" TEXT,
    "reference" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "failureReason" TEXT,
    "notes" TEXT,
    "recordedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" SERIAL NOT NULL,
    "creditNoteNo" TEXT NOT NULL,
    "accountId" INTEGER NOT NULL,
    "invoiceId" INTEGER,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'ISSUED',
    "reason" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Onboarding" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "subscriptionId" INTEGER,
    "status" "OnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "assignedToId" INTEGER,
    "startedAt" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "goLiveAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "blockedReason" TEXT,
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Onboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingTask" (
    "id" SERIAL NOT NULL,
    "onboardingId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "status" "OnboardingTaskStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "assignedToId" INTEGER,
    "completedAt" TIMESTAMP(3),
    "completedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingEvent" (
    "id" SERIAL NOT NULL,
    "onboardingId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "message" TEXT,
    "actorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingTemplateTask" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingTemplateTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesStage" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isWon" BOOLEAN NOT NULL DEFAULT false,
    "isLost" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "stageId" INTEGER NOT NULL,
    "ownerId" INTEGER,
    "productId" INTEGER,
    "planId" INTEGER,
    "amount" DECIMAL(12,2),
    "currency" TEXT,
    "expectedCloseDate" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_accountCode_key" ON "Account"("accountCode");

-- CreateIndex
CREATE INDEX "Account_status_idx" ON "Account"("status");

-- CreateIndex
CREATE INDEX "Account_ownerId_idx" ON "Account"("ownerId");

-- CreateIndex
CREATE INDEX "Account_name_idx" ON "Account"("name");

-- CreateIndex
CREATE INDEX "AccountContact_accountId_idx" ON "AccountContact"("accountId");

-- CreateIndex
CREATE INDEX "AccountContact_email_idx" ON "AccountContact"("email");

-- CreateIndex
CREATE INDEX "AccountAssignment_employeeId_idx" ON "AccountAssignment"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountAssignment_accountId_employeeId_key" ON "AccountAssignment"("accountId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_key_key" ON "Product"("key");

-- CreateIndex
CREATE INDEX "Product_status_idx" ON "Product"("status");

-- CreateIndex
CREATE INDEX "Plan_status_idx" ON "Plan"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_productId_key_key" ON "Plan"("productId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_subscriptionCode_key" ON "Subscription"("subscriptionCode");

-- CreateIndex
CREATE INDEX "Subscription_accountId_idx" ON "Subscription"("accountId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_productId_planId_idx" ON "Subscription"("productId", "planId");

-- CreateIndex
CREATE INDEX "Subscription_renewalDate_idx" ON "Subscription"("renewalDate");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_subscriptionId_createdAt_idx" ON "SubscriptionEvent"("subscriptionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNo_key" ON "Invoice"("invoiceNo");

-- CreateIndex
CREATE INDEX "Invoice_accountId_status_idx" ON "Invoice"("accountId", "status");

-- CreateIndex
CREATE INDEX "Invoice_status_dueDate_idx" ON "Invoice"("status", "dueDate");

-- CreateIndex
CREATE INDEX "Invoice_issueDate_idx" ON "Invoice"("issueDate");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentNo_key" ON "Payment"("paymentNo");

-- CreateIndex
CREATE INDEX "Payment_accountId_idx" ON "Payment"("accountId");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_status_receivedAt_idx" ON "Payment"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_creditNoteNo_key" ON "CreditNote"("creditNoteNo");

-- CreateIndex
CREATE INDEX "CreditNote_accountId_idx" ON "CreditNote"("accountId");

-- CreateIndex
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");

-- CreateIndex
CREATE INDEX "Onboarding_accountId_idx" ON "Onboarding"("accountId");

-- CreateIndex
CREATE INDEX "Onboarding_status_idx" ON "Onboarding"("status");

-- CreateIndex
CREATE INDEX "Onboarding_assignedToId_idx" ON "Onboarding"("assignedToId");

-- CreateIndex
CREATE INDEX "OnboardingTask_onboardingId_status_idx" ON "OnboardingTask"("onboardingId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingTask_onboardingId_key_key" ON "OnboardingTask"("onboardingId", "key");

-- CreateIndex
CREATE INDEX "OnboardingEvent_onboardingId_createdAt_idx" ON "OnboardingEvent"("onboardingId", "createdAt");

-- CreateIndex
CREATE INDEX "OnboardingTemplateTask_productId_idx" ON "OnboardingTemplateTask"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingTemplateTask_productId_key_key" ON "OnboardingTemplateTask"("productId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "SalesStage_key_key" ON "SalesStage"("key");

-- CreateIndex
CREATE INDEX "Opportunity_accountId_idx" ON "Opportunity"("accountId");

-- CreateIndex
CREATE INDEX "Opportunity_stageId_idx" ON "Opportunity"("stageId");

-- CreateIndex
CREATE INDEX "Opportunity_ownerId_idx" ON "Opportunity"("ownerId");

-- CreateIndex
CREATE INDEX "Restaurant_accountId_idx" ON "Restaurant"("accountId");

-- CreateIndex
CREATE INDEX "SupportTicket_accountId_idx" ON "SupportTicket"("accountId");

-- AddForeignKey
ALTER TABLE "Restaurant" ADD CONSTRAINT "Restaurant_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "InternalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountContact" ADD CONSTRAINT "AccountContact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountAssignment" ADD CONSTRAINT "AccountAssignment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountAssignment" ADD CONSTRAINT "AccountAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "InternalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionEvent" ADD CONSTRAINT "SubscriptionEvent_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionEvent" ADD CONSTRAINT "SubscriptionEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "InternalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Onboarding" ADD CONSTRAINT "Onboarding_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Onboarding" ADD CONSTRAINT "Onboarding_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Onboarding" ADD CONSTRAINT "Onboarding_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "InternalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingTask" ADD CONSTRAINT "OnboardingTask_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "Onboarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingTask" ADD CONSTRAINT "OnboardingTask_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "InternalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingTask" ADD CONSTRAINT "OnboardingTask_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "InternalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingEvent" ADD CONSTRAINT "OnboardingEvent_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "Onboarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingEvent" ADD CONSTRAINT "OnboardingEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "InternalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "SalesStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "InternalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill
--
-- Every existing Restaurant becomes its own Account. That is the only mapping
-- the current data supports: nothing records which restaurants belong to the
-- same commercial group, and guessing from a name prefix would silently merge
-- two unrelated businesses. Groups get consolidated by hand afterwards, which
-- is a safe direction to move in — splitting a wrongly-merged account is not.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "Account" (
    "accountCode", "name", "status", "gstNumber", "billingEmail", "billingPhone",
    "billingAddress", "city", "state", "pincode", "notes",
    "becameCustomerAt", "createdAt", "updatedAt"
)
SELECT
    'ACC-' || LPAD(r."id"::text, 4, '0'),
    r."name",
    -- platformStatus carried the commercial lifecycle. Map it across, then stop
    -- reading it.
    CASE r."platformStatus"
        WHEN 'LEAD'        THEN 'LEAD'::"AccountLifecycleStatus"
        WHEN 'ONBOARDING'  THEN 'PROSPECT'::"AccountLifecycleStatus"
        WHEN 'ACTIVE'      THEN 'CUSTOMER'::"AccountLifecycleStatus"
        WHEN 'SUSPENDED'   THEN 'CUSTOMER'::"AccountLifecycleStatus"
        WHEN 'CHURNED'     THEN 'CHURNED'::"AccountLifecycleStatus"
        ELSE 'LEAD'::"AccountLifecycleStatus"
    END,
    r."gstNumber", r."email", r."phone", r."address",
    r."city", r."state", r."pincode", r."internalNotes",
    r."activatedAt",
    r."createdAt", NOW()
FROM "Restaurant" r;

UPDATE "Restaurant" r
SET "accountId" = a."id"
FROM "Account" a
WHERE a."accountCode" = 'ACC-' || LPAD(r."id"::text, 4, '0');

-- Churn detail, where the restaurant was already marked churned.
UPDATE "Account" a
SET "churnedAt" = r."suspendedAt", "churnReason" = r."suspensionReason"
FROM "Restaurant" r
WHERE r."accountId" = a."id" AND a."status" = 'CHURNED';

-- Outlet operational status, derived from the existing flags.
UPDATE "Branch"
SET "operationalStatus" = CASE
    WHEN "isDeleted" THEN 'CLOSED'::"LocationOperationalStatus"
    WHEN "isActive"  THEN 'ACTIVE'::"LocationOperationalStatus"
    ELSE 'INACTIVE'::"LocationOperationalStatus"
END;

-- Tickets follow their restaurant to its account.
UPDATE "SupportTicket" t
SET "accountId" = r."accountId"
FROM "Restaurant" r
WHERE t."restaurantId" = r."id" AND r."accountId" IS NOT NULL;

-- ─── Onboarding ─────────────────────────────────────────────────────────────
-- One Onboarding per account, carrying across the stage the restaurant had
-- reached, then its checklist rows verbatim so no progress is lost.

INSERT INTO "Onboarding" ("accountId", "status", "startedAt", "goLiveAt", "completedAt", "createdAt", "updatedAt")
SELECT
    r."accountId",
    CASE r."onboardingStage"
        WHEN 'LEAD'          THEN 'NOT_STARTED'::"OnboardingStatus"
        WHEN 'INTERESTED'    THEN 'NOT_STARTED'::"OnboardingStatus"
        WHEN 'ONBOARDING'    THEN 'IN_PROGRESS'::"OnboardingStatus"
        WHEN 'VERIFICATION'  THEN 'IN_PROGRESS'::"OnboardingStatus"
        WHEN 'CONFIGURATION' THEN 'IN_PROGRESS'::"OnboardingStatus"
        WHEN 'TESTING'       THEN 'IN_PROGRESS'::"OnboardingStatus"
        WHEN 'READY'         THEN 'READY_FOR_GO_LIVE'::"OnboardingStatus"
        WHEN 'ACTIVE'        THEN 'COMPLETED'::"OnboardingStatus"
        ELSE 'NOT_STARTED'::"OnboardingStatus"
    END,
    r."createdAt",
    r."activatedAt",
    CASE WHEN r."onboardingStage" = 'ACTIVE' THEN r."activatedAt" ELSE NULL END,
    r."createdAt", NOW()
FROM "Restaurant" r
WHERE r."accountId" IS NOT NULL;

INSERT INTO "OnboardingTask" (
    "onboardingId", "key", "label", "category", "isMandatory",
    "status", "notes", "sortOrder", "completedAt", "completedById", "createdAt", "updatedAt"
)
SELECT
    o."id", t."key", t."label", t."category", t."isMandatory",
    t."status", t."notes", t."sortOrder", t."completedAt", t."completedById",
    t."createdAt", NOW()
FROM "RestaurantOnboardingTask" t
JOIN "Restaurant" r ON r."id" = t."restaurantId"
JOIN "Onboarding" o ON o."accountId" = r."accountId"
ON CONFLICT ("onboardingId", "key") DO NOTHING;

-- ─── Product catalogue ──────────────────────────────────────────────────────
-- The two products Dineink sells, and the two plans RDS has. Every commercial
-- term (price, currency, billing interval, trial length) is deliberately left
-- NULL: the business has not defined them, and a placeholder figure would be
-- indistinguishable from a real one once it reached a screen.

INSERT INTO "Product" ("key", "name", "description", "targetSegment", "status", "sortOrder", "createdAt", "updatedAt")
VALUES
    ('DINEINK_DOT', 'Dineink Dot', 'Restaurant software for small and unorganised cafes and restaurants.', 'Small-scale and unorganised restaurants and cafes', 'ACTIVE', 1, NOW(), NOW()),
    ('DINEINK_RDS', 'Dineink RDS', 'Restaurant development and intelligence software for organised restaurant businesses.', 'Organised, medium and large-scale restaurant businesses', 'ACTIVE', 2, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "Plan" ("productId", "key", "name", "description", "status", "sortOrder", "createdAt", "updatedAt")
SELECT p."id", v.key, v.name, v.description, 'ACTIVE'::"PlanStatus", v.sort, NOW(), NOW()
FROM "Product" p
CROSS JOIN (VALUES
    ('PROFESSIONAL', 'Professional', 'For organised, medium-scale restaurant businesses.', 1),
    ('ENTERPRISE',   'Enterprise',   'For large-scale, multi-location restaurant businesses.', 2)
) AS v(key, name, description, sort)
WHERE p."key" = 'DINEINK_RDS'
ON CONFLICT ("productId", "key") DO NOTHING;

-- ─── Onboarding template ────────────────────────────────────────────────────
-- The twelve steps that were hard-coded in onboarding.service.ts, moved into
-- data as the default (productId NULL) template. Unchanged in content — this is
-- a relocation, not a redesign — so that per-product templates can now be added
-- as rows when Dineink defines them.

INSERT INTO "OnboardingTemplateTask" ("productId", "key", "label", "category", "isMandatory", "sortOrder", "createdAt", "updatedAt")
VALUES
    (NULL, 'restaurant_details',    'Customer and business details captured', 'Details',       true,  0,  NOW(), NOW()),
    (NULL, 'owner_contact',         'Primary contact verified',               'Details',       true,  1,  NOW(), NOW()),
    (NULL, 'documents',             'Required documents collected',           'Documents',     true,  2,  NOW(), NOW()),
    (NULL, 'agreement',             'Agreement signed',                       'Documents',     true,  3,  NOW(), NOW()),
    (NULL, 'menu_configured',       'Menu configured',                        'Configuration', true,  4,  NOW(), NOW()),
    (NULL, 'tables_configured',     'Tables configured',                      'Configuration', true,  5,  NOW(), NOW()),
    (NULL, 'qr_generated',          'QR codes generated',                     'Configuration', true,  6,  NOW(), NOW()),
    (NULL, 'users_created',         'Customer users created',                 'Configuration', true,  7,  NOW(), NOW()),
    (NULL, 'payment_configuration', 'Payment configuration complete',         'Configuration', true,  8,  NOW(), NOW()),
    (NULL, 'testing_completed',     'Testing completed',                      'Verification',  true,  9,  NOW(), NOW()),
    (NULL, 'staff_training',        'Staff training delivered',               'Verification',  false, 10, NOW(), NOW()),
    (NULL, 'final_verification',    'Final verification signed off',          'Verification',  true,  11, NOW(), NOW())
ON CONFLICT ("productId", "key") DO NOTHING;

-- ─── Sales pipeline ─────────────────────────────────────────────────────────
-- The stages named in the brief, as editable configuration rather than an enum,
-- because Dineink has not ratified its sales process.

INSERT INTO "SalesStage" ("key", "name", "sortOrder", "isWon", "isLost", "isActive", "createdAt", "updatedAt")
VALUES
    ('LEAD',        'Lead',        0, false, false, true, NOW(), NOW()),
    ('QUALIFIED',   'Qualified',   1, false, false, true, NOW(), NOW()),
    ('DEMO',        'Demo',        2, false, false, true, NOW(), NOW()),
    ('PROPOSAL',    'Proposal',    3, false, false, true, NOW(), NOW()),
    ('NEGOTIATION', 'Negotiation', 4, false, false, true, NOW(), NOW()),
    ('WON',         'Won',         5, true,  false, true, NOW(), NOW()),
    ('LOST',        'Lost',        6, false, true,  true, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;

-- ─── Retire the marketplace settings ────────────────────────────────────────
-- Commission percentage and settlement cycle describe a business Dineink is not
-- in: it sells software on subscription and takes no share of what a restaurant
-- sells. The rows are deleted rather than left unread, so that nobody can set a
-- commission rate for a model that does not exist.
DELETE FROM "PlatformSetting"
WHERE "key" IN ('payments.commissionPercent', 'payments.settlementCycleDays');

-- Restaurant trading inactivity is not a Dineink churn signal. A cafe that has
-- taken no orders for a week is not a customer at risk — we sell them software,
-- we do not run their kitchen. Renewal date and payment status are the real
-- signals, and both now have somewhere to live.
DELETE FROM "PlatformSetting"
WHERE "key" IN ('business.inactiveRestaurantDays', 'business.atRiskRestaurantDays');

-- Feature flags are not a DineInk module. The table is left in place (dropping
-- it is a separate, reversible decision) but the seeded rows go, so nothing
-- surfaces them as a product capability.
DELETE FROM "FeatureFlag"
WHERE "key" IN ('ANALYTICS_V2', 'NEW_ORDER_FLOW', 'NEW_PAYMENT_FLOW');
