import prisma from "../src/config/prisma";
import { classifyUnit, toCanonicalQty, toCanonicalPricePerUnit } from "../src/utils/units";

async function main() {
  console.log("=========================================================");
  console.log("DRY RUN — no data will be written. This only reports what");
  console.log("the real migration WOULD change.");
  console.log("=========================================================\n");

  let unrecognized = 0;

  console.log("### Ingredient ###");
  const ingredients = await prisma.ingredient.findMany({
    select: { id: true, name: true, unit: true, quantity: true, pricePerUnit: true, reorderLevel: true },
  });
  for (const ing of ingredients) {
    const info = classifyUnit(ing.unit);
    if (!info) {
      unrecognized++;
      console.log(`  [UNRECOGNIZED UNIT] #${ing.id} "${ing.name}" unit=${JSON.stringify(ing.unit)} — will be left untouched, needs manual review`);
      continue;
    }
    const qtyResult = ing.quantity != null ? toCanonicalQty(ing.quantity, ing.unit) : null;
    const priceResult = ing.pricePerUnit != null ? toCanonicalPricePerUnit(ing.pricePerUnit, ing.unit) : null;
    const reorderResult = ing.reorderLevel != null ? toCanonicalQty(ing.reorderLevel, ing.unit) : null;
    console.log(
      `  #${ing.id} "${ing.name}": unit ${ing.unit} -> ${info.canonical}` +
        (ing.quantity != null ? ` | quantity ${ing.quantity} -> ${qtyResult?.qty.toFixed(4)}` : "") +
        (ing.pricePerUnit != null ? ` | pricePerUnit ${ing.pricePerUnit} -> ${priceResult?.toFixed(4)}` : "") +
        (ing.reorderLevel != null ? ` | reorderLevel ${ing.reorderLevel} -> ${reorderResult?.qty.toFixed(4)}` : ""),
    );
  }

  console.log("\n### MenuItemIngredient ###");
  const miis = await prisma.menuItemIngredient.findMany({
    select: {
      id: true,
      quantity: true,
      unit: true,
      ingredient: { select: { name: true } },
      menuItem: { select: { name: true } },
    },
  });
  for (const mii of miis) {
    const info = classifyUnit(mii.unit);
    if (!info) {
      unrecognized++;
      console.log(`  [UNRECOGNIZED UNIT] #${mii.id} ${mii.menuItem.name} / ${mii.ingredient.name} unit=${JSON.stringify(mii.unit)} — will be left untouched`);
      continue;
    }
    const qtyResult = toCanonicalQty(mii.quantity, mii.unit);
    console.log(
      `  #${mii.id} "${mii.menuItem.name}" uses "${mii.ingredient.name}": ${mii.quantity} ${mii.unit} -> ${qtyResult?.qty.toFixed(6)} ${info.canonical}`,
    );
  }

  console.log("\n### InventoryRestock (data JSON) ###");
  const restocks = await prisma.inventoryRestock.findMany({
    select: { id: true, month: true, year: true, data: true },
  });
  for (const r of restocks) {
    const data = r.data as Record<string, any[]> | null;
    if (!data) continue;
    console.log(`  Restock #${r.id} (${r.month}/${r.year}):`);
    for (const weekKey of Object.keys(data)) {
      for (const row of data[weekKey] || []) {
        const rawUnit = row["Unit"];
        const info = classifyUnit(rawUnit);
        if (!info) {
          unrecognized++;
          console.log(`    [UNRECOGNIZED UNIT] ${weekKey} / ${row["Ingredient"]} unit=${JSON.stringify(rawUnit)} — will be left untouched`);
          continue;
        }
        const opening = Number(row["Opening Qty"] || 0);
        const purchase = Number(row["Week Purchase"] || 0);
        const closing = Number(row["Closing Qty"] || 0);
        console.log(
          `    ${weekKey} / ${row["Ingredient"]}: unit ${rawUnit} -> ${info.canonical}` +
            ` | Opening ${opening} -> ${(opening * info.toCanonical).toFixed(4)}` +
            ` | Purchase ${purchase} -> ${(purchase * info.toCanonical).toFixed(4)}` +
            ` | Closing ${closing} -> ${(closing * info.toCanonical).toFixed(4)}`,
        );
      }
    }
  }

  console.log("\n### IngredientPriceHistory ###");
  const priceHistoryCount = await prisma.ingredientPriceHistory.count();
  console.log(`  ${priceHistoryCount} rows — these store a price snapshot with no unit field of their own; they'll be converted using their ingredient's own conversion factor at migration time.`);

  console.log("\n=========================================================");
  console.log(`SUMMARY: ${unrecognized} row(s) with an unrecognized unit string — these will be left completely untouched by the real migration (safe default) and should be reviewed by hand.`);
  console.log("=========================================================");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
