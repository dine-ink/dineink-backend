-- CreateTable
CREATE TABLE "Attendance" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "loginTime" TIMESTAMP(3),
    "logoutTime" TIMESTAMP(3),
    "totalHours" DOUBLE PRECISION DEFAULT 0,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceBreak" (
    "id" SERIAL NOT NULL,
    "attendanceId" INTEGER NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "totalMinutes" INTEGER DEFAULT 0,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceBreak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyCashSession" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "openedById" INTEGER NOT NULL,
    "closedById" INTEGER,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "openingCash" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expectedCash" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualCash" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "closingCash" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cashDifference" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyCashSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopExpense" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "expenseType" TEXT,
    "paymentSource" TEXT NOT NULL,
    "paidByUserId" INTEGER,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryAdjustment" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "ingredientId" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "adjustmentType" TEXT NOT NULL,
    "reason" TEXT,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Attendance_userId_idx" ON "Attendance"("userId");

-- CreateIndex
CREATE INDEX "Attendance_branchId_idx" ON "Attendance"("branchId");

-- CreateIndex
CREATE INDEX "Attendance_date_idx" ON "Attendance"("date");

-- CreateIndex
CREATE INDEX "AttendanceBreak_attendanceId_idx" ON "AttendanceBreak"("attendanceId");

-- CreateIndex
CREATE INDEX "DailyCashSession_restaurantId_idx" ON "DailyCashSession"("restaurantId");

-- CreateIndex
CREATE INDEX "DailyCashSession_branchId_idx" ON "DailyCashSession"("branchId");

-- CreateIndex
CREATE INDEX "ShopExpense_restaurantId_idx" ON "ShopExpense"("restaurantId");

-- CreateIndex
CREATE INDEX "ShopExpense_branchId_idx" ON "ShopExpense"("branchId");

-- CreateIndex
CREATE INDEX "InventoryAdjustment_restaurantId_idx" ON "InventoryAdjustment"("restaurantId");

-- CreateIndex
CREATE INDEX "InventoryAdjustment_branchId_idx" ON "InventoryAdjustment"("branchId");

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceBreak" ADD CONSTRAINT "AttendanceBreak_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCashSession" ADD CONSTRAINT "DailyCashSession_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCashSession" ADD CONSTRAINT "DailyCashSession_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopExpense" ADD CONSTRAINT "ShopExpense_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopExpense" ADD CONSTRAINT "ShopExpense_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
