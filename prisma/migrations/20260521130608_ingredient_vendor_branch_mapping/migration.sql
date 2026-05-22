-- CreateTable
CREATE TABLE "IngredientVendor" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "ingredientId" INTEGER NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngredientVendor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IngredientVendor_branchId_idx" ON "IngredientVendor"("branchId");

-- CreateIndex
CREATE INDEX "IngredientVendor_ingredientId_idx" ON "IngredientVendor"("ingredientId");

-- CreateIndex
CREATE INDEX "IngredientVendor_vendorId_idx" ON "IngredientVendor"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "IngredientVendor_branchId_ingredientId_key" ON "IngredientVendor"("branchId", "ingredientId");

-- AddForeignKey
ALTER TABLE "IngredientVendor" ADD CONSTRAINT "IngredientVendor_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientVendor" ADD CONSTRAINT "IngredientVendor_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientVendor" ADD CONSTRAINT "IngredientVendor_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
