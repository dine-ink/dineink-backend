-- AlterTable
ALTER TABLE "Branch" ADD COLUMN "closingTime" TEXT;

-- CreateTable
CREATE TABLE "SopChecklist" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "menuItemId" INTEGER,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "steps" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SopChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SopChecklist_restaurantId_idx" ON "SopChecklist"("restaurantId");

-- CreateIndex
CREATE INDEX "SopChecklist_branchId_idx" ON "SopChecklist"("branchId");

-- CreateIndex
CREATE INDEX "SopChecklist_menuItemId_idx" ON "SopChecklist"("menuItemId");

-- AddForeignKey
ALTER TABLE "SopChecklist" ADD CONSTRAINT "SopChecklist_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopChecklist" ADD CONSTRAINT "SopChecklist_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SopChecklist" ADD CONSTRAINT "SopChecklist_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
