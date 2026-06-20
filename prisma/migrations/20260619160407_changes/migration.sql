-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "email" TEXT;

-- CreateTable
CREATE TABLE "VendorPayment" (
    "id" SERIAL NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentMethod" TEXT,
    "notes" TEXT,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorInvoice" (
    "id" SERIAL NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "invoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'UNPAID',
    "items" JSONB,
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredientPriceHistory" (
    "id" SERIAL NOT NULL,
    "ingredientId" INTEGER NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "oldPrice" DOUBLE PRECISION,
    "newPrice" DOUBLE PRECISION NOT NULL,
    "changedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngredientPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorPayment_vendorId_idx" ON "VendorPayment"("vendorId");

-- CreateIndex
CREATE INDEX "VendorPayment_restaurantId_idx" ON "VendorPayment"("restaurantId");

-- CreateIndex
CREATE INDEX "VendorPayment_branchId_idx" ON "VendorPayment"("branchId");

-- CreateIndex
CREATE INDEX "VendorInvoice_vendorId_idx" ON "VendorInvoice"("vendorId");

-- CreateIndex
CREATE INDEX "VendorInvoice_restaurantId_idx" ON "VendorInvoice"("restaurantId");

-- CreateIndex
CREATE INDEX "VendorInvoice_branchId_idx" ON "VendorInvoice"("branchId");

-- CreateIndex
CREATE INDEX "IngredientPriceHistory_ingredientId_idx" ON "IngredientPriceHistory"("ingredientId");

-- CreateIndex
CREATE INDEX "IngredientPriceHistory_restaurantId_idx" ON "IngredientPriceHistory"("restaurantId");

-- AddForeignKey
ALTER TABLE "VendorPayment" ADD CONSTRAINT "VendorPayment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPayment" ADD CONSTRAINT "VendorPayment_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPayment" ADD CONSTRAINT "VendorPayment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorInvoice" ADD CONSTRAINT "VendorInvoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorInvoice" ADD CONSTRAINT "VendorInvoice_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorInvoice" ADD CONSTRAINT "VendorInvoice_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientPriceHistory" ADD CONSTRAINT "IngredientPriceHistory_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientPriceHistory" ADD CONSTRAINT "IngredientPriceHistory_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
