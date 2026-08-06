-- Additive-only migration (no DROP statements) generated via
-- `prisma migrate diff` against a live introspection of production, then
-- hand-verified, rather than `prisma migrate dev` — dev's own diff against
-- the checked-in schema.prisma wanted to drop RestaurantInsights.capitalEmployed,
-- RestaurantInsights.propertyValue, and RunningOrder.orderStatus (17,341
-- non-null rows), which are pre-existing drift unrelated to this feature work
-- and were deliberately left untouched. See IMPLEMENTATION_PLAN.md's
-- technical-debt section.
--
-- Adds foundation models for: Equipment Data List, Compliance Checker, Dues
-- Tracker, EMI schedules (shared by Equipment/Dues/Cash Flow), WhatsApp
-- Integration, Payroll extensions (leave/deductions/payroll runs), and
-- Account & Bank Integration (bank accounts/UPI config/manual bank
-- transaction entries) — plus Vendor Intelligence's vendorType/documentUrl
-- fields and Branch's Peak Hour Depletion capacity policy fields.

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "autoThrottleEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kitchenCapacityPerHour" INTEGER;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "vendorType" TEXT;

-- AlterTable
ALTER TABLE "VendorInvoice" ADD COLUMN     "documentUrl" TEXT;

-- CreateTable
CREATE TABLE "EmiSchedule" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "name" TEXT NOT NULL,
    "principalAmount" DOUBLE PRECISION NOT NULL,
    "emiAmount" DOUBLE PRECISION NOT NULL,
    "dueDayOfMonth" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "tenureMonths" INTEGER NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmiSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "capacity" TEXT,
    "volume" TEXT,
    "itemCapacityCount" INTEGER,
    "powerConsumptionKw" DOUBLE PRECISION,
    "purchasePrice" DOUBLE PRECISION,
    "purchaseDate" TIMESTAMP(3),
    "emiScheduleId" INTEGER,
    "installationDate" TIMESTAMP(3),
    "warrantyExpiryDate" TIMESTAMP(3),
    "expectedLifespanMonths" INTEGER,
    "serviceProviderName" TEXT,
    "serviceProviderContact" TEXT,
    "nextMaintenanceDate" TIMESTAMP(3),
    "maintenanceNotes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceRecord" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "licenseNumber" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "nextDueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'VALID',
    "documentUrl" TEXT,
    "lastRenewedDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyDue" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "amountDue" DOUBLE PRECISION NOT NULL,
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "paidDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyDue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessageLog" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "direction" TEXT NOT NULL DEFAULT 'OUTBOUND',
    "recipientPhone" TEXT NOT NULL,
    "templateType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "relatedEntityType" TEXT,
    "relatedEntityId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "leaveType" TEXT NOT NULL DEFAULT 'CASUAL',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryDeduction" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "deductionType" TEXT NOT NULL DEFAULT 'OTHER',
    "amount" DOUBLE PRECISION NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSED',
    "totalPayout" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "generatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRunLine" (
    "id" SERIAL NOT NULL,
    "payrollRunId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "baseSalary" DOUBLE PRECISION NOT NULL,
    "overtimePay" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deductions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netPay" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PayrollRunLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "accountHolderName" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumberMasked" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpiConfig" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "upiId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpiConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransactionEntry" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "bankAccountId" INTEGER,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" TEXT NOT NULL,
    "reconciliationStatus" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "matchedBillId" INTEGER,
    "matchedVendorPaymentId" INTEGER,
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankTransactionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmiSchedule_restaurantId_idx" ON "EmiSchedule"("restaurantId");

-- CreateIndex
CREATE INDEX "EmiSchedule_branchId_idx" ON "EmiSchedule"("branchId");

-- CreateIndex
CREATE INDEX "Equipment_restaurantId_idx" ON "Equipment"("restaurantId");

-- CreateIndex
CREATE INDEX "Equipment_branchId_idx" ON "Equipment"("branchId");

-- CreateIndex
CREATE INDEX "Equipment_emiScheduleId_idx" ON "Equipment"("emiScheduleId");

-- CreateIndex
CREATE INDEX "ComplianceRecord_restaurantId_idx" ON "ComplianceRecord"("restaurantId");

-- CreateIndex
CREATE INDEX "ComplianceRecord_branchId_idx" ON "ComplianceRecord"("branchId");

-- CreateIndex
CREATE INDEX "ComplianceRecord_type_idx" ON "ComplianceRecord"("type");

-- CreateIndex
CREATE INDEX "MonthlyDue_restaurantId_idx" ON "MonthlyDue"("restaurantId");

-- CreateIndex
CREATE INDEX "MonthlyDue_branchId_idx" ON "MonthlyDue"("branchId");

-- CreateIndex
CREATE INDEX "MonthlyDue_month_year_idx" ON "MonthlyDue"("month", "year");

-- CreateIndex
CREATE INDEX "WhatsAppMessageLog_restaurantId_idx" ON "WhatsAppMessageLog"("restaurantId");

-- CreateIndex
CREATE INDEX "WhatsAppMessageLog_branchId_idx" ON "WhatsAppMessageLog"("branchId");

-- CreateIndex
CREATE INDEX "LeaveRequest_userId_idx" ON "LeaveRequest"("userId");

-- CreateIndex
CREATE INDEX "LeaveRequest_restaurantId_idx" ON "LeaveRequest"("restaurantId");

-- CreateIndex
CREATE INDEX "LeaveRequest_branchId_idx" ON "LeaveRequest"("branchId");

-- CreateIndex
CREATE INDEX "SalaryDeduction_userId_idx" ON "SalaryDeduction"("userId");

-- CreateIndex
CREATE INDEX "SalaryDeduction_restaurantId_idx" ON "SalaryDeduction"("restaurantId");

-- CreateIndex
CREATE INDEX "SalaryDeduction_branchId_idx" ON "SalaryDeduction"("branchId");

-- CreateIndex
CREATE INDEX "SalaryDeduction_month_year_idx" ON "SalaryDeduction"("month", "year");

-- CreateIndex
CREATE INDEX "PayrollRun_restaurantId_idx" ON "PayrollRun"("restaurantId");

-- CreateIndex
CREATE INDEX "PayrollRun_branchId_idx" ON "PayrollRun"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_branchId_month_year_key" ON "PayrollRun"("branchId", "month", "year");

-- CreateIndex
CREATE INDEX "PayrollRunLine_payrollRunId_idx" ON "PayrollRunLine"("payrollRunId");

-- CreateIndex
CREATE INDEX "PayrollRunLine_userId_idx" ON "PayrollRunLine"("userId");

-- CreateIndex
CREATE INDEX "BankAccount_restaurantId_idx" ON "BankAccount"("restaurantId");

-- CreateIndex
CREATE INDEX "BankAccount_branchId_idx" ON "BankAccount"("branchId");

-- CreateIndex
CREATE INDEX "UpiConfig_restaurantId_idx" ON "UpiConfig"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "UpiConfig_branchId_key" ON "UpiConfig"("branchId");

-- CreateIndex
CREATE INDEX "BankTransactionEntry_restaurantId_idx" ON "BankTransactionEntry"("restaurantId");

-- CreateIndex
CREATE INDEX "BankTransactionEntry_branchId_idx" ON "BankTransactionEntry"("branchId");

-- AddForeignKey
ALTER TABLE "EmiSchedule" ADD CONSTRAINT "EmiSchedule_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmiSchedule" ADD CONSTRAINT "EmiSchedule_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_emiScheduleId_fkey" FOREIGN KEY ("emiScheduleId") REFERENCES "EmiSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceRecord" ADD CONSTRAINT "ComplianceRecord_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceRecord" ADD CONSTRAINT "ComplianceRecord_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyDue" ADD CONSTRAINT "MonthlyDue_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyDue" ADD CONSTRAINT "MonthlyDue_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessageLog" ADD CONSTRAINT "WhatsAppMessageLog_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessageLog" ADD CONSTRAINT "WhatsAppMessageLog_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryDeduction" ADD CONSTRAINT "SalaryDeduction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryDeduction" ADD CONSTRAINT "SalaryDeduction_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryDeduction" ADD CONSTRAINT "SalaryDeduction_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRunLine" ADD CONSTRAINT "PayrollRunLine_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRunLine" ADD CONSTRAINT "PayrollRunLine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpiConfig" ADD CONSTRAINT "UpiConfig_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpiConfig" ADD CONSTRAINT "UpiConfig_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransactionEntry" ADD CONSTRAINT "BankTransactionEntry_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransactionEntry" ADD CONSTRAINT "BankTransactionEntry_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
