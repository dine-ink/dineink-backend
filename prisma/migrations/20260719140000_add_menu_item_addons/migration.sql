-- CreateTable
CREATE TABLE "AddOnGroup" (
    "id" SERIAL NOT NULL,
    "restaurantId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AddOnGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddOn" (
    "id" SERIAL NOT NULL,
    "addOnGroupId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItemAddOnGroup" (
    "id" SERIAL NOT NULL,
    "menuItemId" INTEGER NOT NULL,
    "addOnGroupId" INTEGER NOT NULL,

    CONSTRAINT "MenuItemAddOnGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillItemAddOn" (
    "id" SERIAL NOT NULL,
    "billItemId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillItemAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunningOrderBatchItemAddOn" (
    "id" SERIAL NOT NULL,
    "runningOrderBatchItemId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunningOrderBatchItemAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AddOnGroup_restaurantId_idx" ON "AddOnGroup"("restaurantId");

-- CreateIndex
CREATE INDEX "AddOn_addOnGroupId_idx" ON "AddOn"("addOnGroupId");

-- CreateIndex
CREATE INDEX "MenuItemAddOnGroup_menuItemId_idx" ON "MenuItemAddOnGroup"("menuItemId");

-- CreateIndex
CREATE INDEX "MenuItemAddOnGroup_addOnGroupId_idx" ON "MenuItemAddOnGroup"("addOnGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItemAddOnGroup_menuItemId_addOnGroupId_key" ON "MenuItemAddOnGroup"("menuItemId", "addOnGroupId");

-- CreateIndex
CREATE INDEX "BillItemAddOn_billItemId_idx" ON "BillItemAddOn"("billItemId");

-- CreateIndex
CREATE INDEX "RunningOrderBatchItemAddOn_runningOrderBatchItemId_idx" ON "RunningOrderBatchItemAddOn"("runningOrderBatchItemId");

-- AddForeignKey
ALTER TABLE "AddOnGroup" ADD CONSTRAINT "AddOnGroup_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddOn" ADD CONSTRAINT "AddOn_addOnGroupId_fkey" FOREIGN KEY ("addOnGroupId") REFERENCES "AddOnGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemAddOnGroup" ADD CONSTRAINT "MenuItemAddOnGroup_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemAddOnGroup" ADD CONSTRAINT "MenuItemAddOnGroup_addOnGroupId_fkey" FOREIGN KEY ("addOnGroupId") REFERENCES "AddOnGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillItemAddOn" ADD CONSTRAINT "BillItemAddOn_billItemId_fkey" FOREIGN KEY ("billItemId") REFERENCES "BillItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunningOrderBatchItemAddOn" ADD CONSTRAINT "RunningOrderBatchItemAddOn_runningOrderBatchItemId_fkey" FOREIGN KEY ("runningOrderBatchItemId") REFERENCES "RunningOrderBatchItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
