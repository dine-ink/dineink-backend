-- Dine Inc. Internal Operations Platform - additive only.
--
-- Adds the tables the internal employee application owns (identity, RBAC,
-- sessions, audit, support tickets, onboarding checklist, platform settings,
-- feature flags) plus nullable/defaulted columns on Restaurant and
-- RestaurantTable. Nothing here drops or rewrites existing data.
--
-- NOTE: `prisma migrate diff` against the live database also emitted DDL for
-- pre-existing drift that has nothing to do with this change - it wanted to
-- DROP RestaurantInsights.capitalEmployed / .propertyValue and
-- RunningOrder.orderStatus (columns present in the database but absent from
-- schema.prisma), and to drop-and-recreate seven *_branchId_fkey constraints.
-- All of that was removed by hand so this migration cannot destroy production
-- columns. The drift itself is still there and should be reconciled
-- deliberately in its own migration.
-- CreateEnum
CREATE TYPE "RestaurantPlatformStatus" AS ENUM ('LEAD', 'ONBOARDING', 'ACTIVE', 'SUSPENDED', 'CHURNED');

-- CreateEnum
CREATE TYPE "RestaurantOnboardingStage" AS ENUM ('LEAD', 'INTERESTED', 'ONBOARDING', 'VERIFICATION', 'CONFIGURATION', 'TESTING', 'READY', 'ACTIVE');

-- CreateEnum
CREATE TYPE "InternalUserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "OnboardingTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('PAYMENT', 'ORDER', 'RESTAURANT', 'CUSTOMER', 'LOGIN', 'QR', 'MENU', 'ACCOUNT', 'TECHNICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('NEW', 'TRIAGED', 'IN_PROGRESS', 'WAITING_FOR_INFORMATION', 'ESCALATED_TO_ENGINEERING', 'ENGINEERING_RESOLVED', 'VERIFICATION', 'RESOLVED', 'CLOSED');

-- AlterTable
ALTER TABLE "Restaurant" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "city" TEXT,
ADD COLUMN     "cuisine" TEXT,
ADD COLUMN     "internalNotes" TEXT,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3),
ADD COLUMN     "onboardingStage" "RestaurantOnboardingStage" NOT NULL DEFAULT 'LEAD',
ADD COLUMN     "pincode" TEXT,
ADD COLUMN     "platformStatus" "RestaurantPlatformStatus" NOT NULL DEFAULT 'ONBOARDING',
ADD COLUMN     "state" TEXT,
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspensionReason" TEXT;

-- AlterTable
ALTER TABLE "RestaurantTable" ADD COLUMN     "qrEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "qrGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "qrToken" TEXT;

-- CreateTable
CREATE TABLE "InternalUser" (
    "id" SERIAL NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "phone" TEXT,
    "department" TEXT,
    "designation" TEXT,
    "status" "InternalUserStatus" NOT NULL DEFAULT 'ACTIVE',
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorRequired" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" TEXT,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalRole" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalRolePermission" (
    "id" SERIAL NOT NULL,
    "roleId" INTEGER NOT NULL,
    "permission" TEXT NOT NULL,

    CONSTRAINT "InternalRolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalUserRole" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "roleId" INTEGER NOT NULL,
    "grantedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalUserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalSession" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "InternalSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalPasswordResetToken" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalPasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalLoginAttempt" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalLoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalAuditLog" (
    "id" SERIAL NOT NULL,
    "actorId" INTEGER,
    "actorEmail" TEXT,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "resourceLabel" TEXT,
    "previousValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantOnboardingTask" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "status" "OnboardingTaskStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "completedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestaurantOnboardingTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" SERIAL NOT NULL,
    "ticketNo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "TicketCategory" NOT NULL,
    "priority" "TicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TicketStatus" NOT NULL DEFAULT 'NEW',
    "createdById" INTEGER NOT NULL,
    "assignedToId" INTEGER,
    "restaurantId" INTEGER,
    "customerId" INTEGER,
    "billId" INTEGER,
    "runningOrderId" INTEGER,
    "errorCode" TEXT,
    "correlationId" TEXT,
    "environment" TEXT,
    "jiraIssueKey" TEXT,
    "jiraIssueUrl" TEXT,
    "jiraStatus" TEXT,
    "jiraSyncedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicketComment" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTicketComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicketEvent" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "actorId" INTEGER,
    "type" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTicketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicketAttachment" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER,
    "uploadedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTicketAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updatedById" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InternalUser_employeeCode_key" ON "InternalUser"("employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "InternalUser_email_key" ON "InternalUser"("email");

-- CreateIndex
CREATE INDEX "InternalUser_status_idx" ON "InternalUser"("status");

-- CreateIndex
CREATE INDEX "InternalUser_department_idx" ON "InternalUser"("department");

-- CreateIndex
CREATE UNIQUE INDEX "InternalRole_key_key" ON "InternalRole"("key");

-- CreateIndex
CREATE INDEX "InternalRolePermission_permission_idx" ON "InternalRolePermission"("permission");

-- CreateIndex
CREATE UNIQUE INDEX "InternalRolePermission_roleId_permission_key" ON "InternalRolePermission"("roleId", "permission");

-- CreateIndex
CREATE INDEX "InternalUserRole_roleId_idx" ON "InternalUserRole"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "InternalUserRole_userId_roleId_key" ON "InternalUserRole"("userId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "InternalSession_tokenId_key" ON "InternalSession"("tokenId");

-- CreateIndex
CREATE INDEX "InternalSession_userId_idx" ON "InternalSession"("userId");

-- CreateIndex
CREATE INDEX "InternalSession_expiresAt_idx" ON "InternalSession"("expiresAt");

-- CreateIndex
CREATE INDEX "InternalPasswordResetToken_userId_idx" ON "InternalPasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "InternalLoginAttempt_email_createdAt_idx" ON "InternalLoginAttempt"("email", "createdAt");

-- CreateIndex
CREATE INDEX "InternalLoginAttempt_createdAt_idx" ON "InternalLoginAttempt"("createdAt");

-- CreateIndex
CREATE INDEX "InternalAuditLog_actorId_createdAt_idx" ON "InternalAuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "InternalAuditLog_resourceType_resourceId_idx" ON "InternalAuditLog"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "InternalAuditLog_action_createdAt_idx" ON "InternalAuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "InternalAuditLog_createdAt_idx" ON "InternalAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "RestaurantOnboardingTask_restaurantId_status_idx" ON "RestaurantOnboardingTask"("restaurantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantOnboardingTask_restaurantId_key_key" ON "RestaurantOnboardingTask"("restaurantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_ticketNo_key" ON "SupportTicket"("ticketNo");

-- CreateIndex
CREATE INDEX "SupportTicket_status_priority_idx" ON "SupportTicket"("status", "priority");

-- CreateIndex
CREATE INDEX "SupportTicket_restaurantId_idx" ON "SupportTicket"("restaurantId");

-- CreateIndex
CREATE INDEX "SupportTicket_assignedToId_idx" ON "SupportTicket"("assignedToId");

-- CreateIndex
CREATE INDEX "SupportTicket_createdAt_idx" ON "SupportTicket"("createdAt");

-- CreateIndex
CREATE INDEX "SupportTicketComment_ticketId_idx" ON "SupportTicketComment"("ticketId");

-- CreateIndex
CREATE INDEX "SupportTicketEvent_ticketId_createdAt_idx" ON "SupportTicketEvent"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicketAttachment_ticketId_idx" ON "SupportTicketAttachment"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformSetting_key_key" ON "PlatformSetting"("key");

-- CreateIndex
CREATE INDEX "PlatformSetting_group_idx" ON "PlatformSetting"("group");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");

-- CreateIndex
CREATE INDEX "BillItem_billId_idx" ON "BillItem"("billId");

-- CreateIndex
CREATE INDEX "Restaurant_platformStatus_idx" ON "Restaurant"("platformStatus");

-- CreateIndex
CREATE INDEX "Restaurant_onboardingStage_idx" ON "Restaurant"("onboardingStage");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantTable_qrToken_key" ON "RestaurantTable"("qrToken");

-- CreateIndex
CREATE INDEX "RestaurantTable_branchId_idx" ON "RestaurantTable"("branchId");

-- CreateIndex
CREATE INDEX "RestaurantTable_restaurantId_idx" ON "RestaurantTable"("restaurantId");

-- AddForeignKey
ALTER TABLE "InternalRolePermission" ADD CONSTRAINT "InternalRolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "InternalRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalUserRole" ADD CONSTRAINT "InternalUserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "InternalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalUserRole" ADD CONSTRAINT "InternalUserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "InternalRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalSession" ADD CONSTRAINT "InternalSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "InternalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalPasswordResetToken" ADD CONSTRAINT "InternalPasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "InternalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantOnboardingTask" ADD CONSTRAINT "RestaurantOnboardingTask_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantOnboardingTask" ADD CONSTRAINT "RestaurantOnboardingTask_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "InternalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "InternalUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "InternalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketComment" ADD CONSTRAINT "SupportTicketComment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketComment" ADD CONSTRAINT "SupportTicketComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "InternalUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketEvent" ADD CONSTRAINT "SupportTicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketEvent" ADD CONSTRAINT "SupportTicketEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "InternalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketAttachment" ADD CONSTRAINT "SupportTicketAttachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

