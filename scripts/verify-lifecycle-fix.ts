import prisma from "../src/config/prisma";
import { getIngredientLifecycleService } from "../src/modules/inventory/inventory.service";

async function main() {
  const restock = await prisma.inventoryRestock.findFirst();
  if (!restock) return console.log("no restock record found");
  const result = await getIngredientLifecycleService(
    restock.restaurantId,
    restock.branchId,
    restock.month,
    restock.year,
  );
  for (const ing of result) {
    console.log(
      `${ing.name}: opening=${ing.openingQty} purchases=${ing.purchases} available=${ing.available} closing=${ing.closingQty} consumed=${ing.consumed} expectedConsumption=${ing.expectedConsumption} wastageQty=${ing.wastageQty} wastageCost=${ing.wastageCost}`,
    );
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
