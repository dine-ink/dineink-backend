-- DropForeignKey
ALTER TABLE "RunningOrderBatch" DROP CONSTRAINT "RunningOrderBatch_runningOrderId_fkey";

-- DropForeignKey
ALTER TABLE "RunningOrderBatchItem" DROP CONSTRAINT "RunningOrderBatchItem_runningOrderBatchId_fkey";

-- CreateIndex
CREATE INDEX "Bill_restaurantId_branchId_createdAt_idx" ON "Bill"("restaurantId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "Bill_restaurantId_createdAt_idx" ON "Bill"("restaurantId", "createdAt");

-- CreateIndex
CREATE INDEX "RunningOrder_restaurantId_branchId_status_idx" ON "RunningOrder"("restaurantId", "branchId", "status");

-- AddForeignKey
ALTER TABLE "RunningOrderBatch" ADD CONSTRAINT "RunningOrderBatch_runningOrderId_fkey" FOREIGN KEY ("runningOrderId") REFERENCES "RunningOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunningOrderBatchItem" ADD CONSTRAINT "RunningOrderBatchItem_runningOrderBatchId_fkey" FOREIGN KEY ("runningOrderBatchId") REFERENCES "RunningOrderBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
