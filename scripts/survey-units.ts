import prisma from "../src/config/prisma";

async function main() {
  console.log("=== Ingredient.unit distinct values + counts ===");
  const ingredients = await prisma.ingredient.groupBy({
    by: ["unit"],
    _count: { unit: true },
  });
  for (const row of ingredients) {
    console.log(`  ${JSON.stringify(row.unit)}: ${row._count.unit}`);
  }

  console.log("\n=== MenuItemIngredient.unit distinct values + counts ===");
  const miis = await prisma.menuItemIngredient.groupBy({
    by: ["unit"],
    _count: { unit: true },
  });
  for (const row of miis) {
    console.log(`  ${JSON.stringify(row.unit)}: ${row._count.unit}`);
  }

  console.log("\n=== InventoryRestock: distinct 'Unit' values found inside data JSON ===");
  const restocks = await prisma.inventoryRestock.findMany({
    select: { id: true, data: true },
  });
  const unitCounts = new Map<string, number>();
  let totalRows = 0;
  for (const r of restocks) {
    const data = r.data as Record<string, any[]> | null;
    if (!data) continue;
    for (const weekKey of Object.keys(data)) {
      for (const row of data[weekKey] || []) {
        totalRows++;
        const u = String(row["Unit"] ?? "");
        unitCounts.set(u, (unitCounts.get(u) || 0) + 1);
      }
    }
  }
  console.log(`  (scanned ${restocks.length} restock records, ${totalRows} ingredient-week rows)`);
  for (const [unit, count] of [...unitCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${JSON.stringify(unit)}: ${count}`);
  }

  console.log("\n=== Row counts (for migration sizing) ===");
  console.log(`  Ingredient: ${await prisma.ingredient.count()}`);
  console.log(`  MenuItemIngredient: ${await prisma.menuItemIngredient.count()}`);
  console.log(`  InventoryRestock: ${await prisma.inventoryRestock.count()}`);
  console.log(`  IngredientPriceHistory: ${await prisma.ingredientPriceHistory.count()}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
