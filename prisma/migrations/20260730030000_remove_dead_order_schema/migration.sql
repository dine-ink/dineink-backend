-- Order/OrderItem were confirmed dead: zero rows in production, and no
-- application code creates a row in either table (the seed generator's own
-- docstring documented this before the models were removed from schema.prisma).
-- OrderItem must drop before Order (FK dependency); OrderStatus enum only
-- backed Order.status, so it can drop once both tables are gone.

-- DropForeignKey
ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_orderId_fkey";

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_restaurantId_fkey";

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_branchId_fkey";

-- DropTable
DROP TABLE IF EXISTS "OrderItem";

-- DropTable
DROP TABLE IF EXISTS "Order";

-- DropEnum
DROP TYPE IF EXISTS "OrderStatus";
