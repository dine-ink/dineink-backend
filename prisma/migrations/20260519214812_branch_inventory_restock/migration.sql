/*
  Warnings:

  - A unique constraint covering the columns `[restaurantId,branchId,month,year]` on the table `InventoryRestock` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `branchId` to the `InventoryRestock` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "InventoryRestock_restaurantId_month_year_key";

-- AlterTable
ALTER TABLE "InventoryRestock" ADD COLUMN     "branchId" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "InventoryRestock_restaurantId_idx" ON "InventoryRestock"("restaurantId");

-- CreateIndex
CREATE INDEX "InventoryRestock_branchId_idx" ON "InventoryRestock"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryRestock_restaurantId_branchId_month_year_key" ON "InventoryRestock"("restaurantId", "branchId", "month", "year");

-- AddForeignKey
ALTER TABLE "InventoryRestock" ADD CONSTRAINT "InventoryRestock_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
