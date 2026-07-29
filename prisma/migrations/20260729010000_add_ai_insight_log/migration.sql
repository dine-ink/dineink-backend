-- CreateTable
CREATE TABLE "AIInsightLog" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "supportingMetrics" JSONB NOT NULL,
    "recommendedActions" JSONB NOT NULL,
    "relatedScreens" JSONB NOT NULL,
    "logDate" TIMESTAMP(3) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIInsightLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AIInsightLog_restaurantId_idx" ON "AIInsightLog"("restaurantId");

-- CreateIndex
CREATE INDEX "AIInsightLog_restaurantId_logDate_idx" ON "AIInsightLog"("restaurantId", "logDate");

-- CreateIndex
CREATE INDEX "AIInsightLog_restaurantId_branchId_category_title_logDate_idx" ON "AIInsightLog"("restaurantId", "branchId", "category", "title", "logDate");

-- AddForeignKey
ALTER TABLE "AIInsightLog" ADD CONSTRAINT "AIInsightLog_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIInsightLog" ADD CONSTRAINT "AIInsightLog_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
