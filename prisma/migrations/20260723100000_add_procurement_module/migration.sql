-- CreateEnum
CREATE TYPE "ProcurementAvailability" AS ENUM ('IN_STOCK', 'LIMITED_STOCK', 'OUT_OF_STOCK', 'UNKNOWN');

-- CreateTable
CREATE TABLE "Supplier" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "iconUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcurementPriceSnapshot" (
    "id" SERIAL NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "searchTerm" TEXT NOT NULL,
    "city" TEXT,
    "productName" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "availability" "ProcurementAvailability" NOT NULL DEFAULT 'UNKNOWN',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "sourceUrl" TEXT,
    "capturedByRestaurantId" INTEGER,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcurementPriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE INDEX "ProcurementPriceSnapshot_supplierId_searchTerm_city_idx" ON "ProcurementPriceSnapshot"("supplierId", "searchTerm", "city");

-- CreateIndex
CREATE INDEX "ProcurementPriceSnapshot_searchTerm_capturedAt_idx" ON "ProcurementPriceSnapshot"("searchTerm", "capturedAt");

-- AddForeignKey
ALTER TABLE "ProcurementPriceSnapshot" ADD CONSTRAINT "ProcurementPriceSnapshot_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
