-- AlterTable
ALTER TABLE "RestaurantTable" ADD COLUMN     "isTemporary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parentTableIds" TEXT,
ADD COLUMN     "tempTableType" TEXT;
