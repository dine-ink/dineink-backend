-- CreateIndex
CREATE INDEX "ShopExpense_paidByUserId_idx" ON "ShopExpense"("paidByUserId");

-- AddForeignKey
ALTER TABLE "ShopExpense" ADD CONSTRAINT "ShopExpense_paidByUserId_fkey" FOREIGN KEY ("paidByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
