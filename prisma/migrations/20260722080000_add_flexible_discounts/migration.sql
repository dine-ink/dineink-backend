-- AlterTable
ALTER TABLE "BillingSettings" ADD COLUMN "discountApprovalThreshold" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Bill" ADD COLUMN "discountType" TEXT DEFAULT 'PERCENTAGE';
ALTER TABLE "Bill" ADD COLUMN "discountCode" TEXT;
ALTER TABLE "Bill" ADD COLUMN "discountApprovedById" INTEGER;

-- CreateTable
CREATE TABLE "DiscountCode" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscountCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscountCode_restaurantId_idx" ON "DiscountCode"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountCode_restaurantId_code_key" ON "DiscountCode"("restaurantId", "code");

-- AddForeignKey
ALTER TABLE "DiscountCode" ADD CONSTRAINT "DiscountCode_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
