-- CreateTable
CREATE TABLE "ExecutiveKpiTarget" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "kpiKey" TEXT NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutiveKpiTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDashboardPreference" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "layout" JSONB,
    "pinnedKpis" JSONB,
    "defaultPeriod" TEXT,
    "defaultBranchId" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserDashboardPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExecutiveKpiTarget_restaurantId_idx" ON "ExecutiveKpiTarget"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutiveKpiTarget_restaurantId_branchId_kpiKey_key" ON "ExecutiveKpiTarget"("restaurantId", "branchId", "kpiKey");

-- CreateIndex
CREATE UNIQUE INDEX "UserDashboardPreference_userId_key" ON "UserDashboardPreference"("userId");

-- CreateIndex
CREATE INDEX "UserDashboardPreference_restaurantId_idx" ON "UserDashboardPreference"("restaurantId");

-- AddForeignKey
ALTER TABLE "ExecutiveKpiTarget" ADD CONSTRAINT "ExecutiveKpiTarget_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutiveKpiTarget" ADD CONSTRAINT "ExecutiveKpiTarget_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutiveKpiTarget" ADD CONSTRAINT "ExecutiveKpiTarget_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDashboardPreference" ADD CONSTRAINT "UserDashboardPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDashboardPreference" ADD CONSTRAINT "UserDashboardPreference_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
