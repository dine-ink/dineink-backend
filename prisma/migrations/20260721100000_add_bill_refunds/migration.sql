-- AlterTable
ALTER TABLE "Bill" ADD COLUMN "refundedAmount" DOUBLE PRECISION DEFAULT 0;

-- CreateTable
CREATE TABLE "BillRefund" (
    "id" SERIAL NOT NULL,
    "billId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillRefund_billId_idx" ON "BillRefund"("billId");

-- AddForeignKey
ALTER TABLE "BillRefund" ADD CONSTRAINT "BillRefund_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
