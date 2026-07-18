// One-time data migration: converts every stored Ingredient / MenuItemIngredient
// / InventoryRestock quantity into the canonical unit system (Kg / Litre / Piece).
// Run scripts/migrate-units-dry-run.ts first to review what this will do.
import prisma from "../src/config/prisma";
import { classifyUnit, toCanonicalQty, toCanonicalPricePerUnit } from "../src/utils/units";

// Restock JSON row field categorization — only genuine quantity / per-unit
// price fields get converted. Money totals (Day N Total, Opening/Closing
// Value, Week Purchase, Week Inventory Cost, Expense) are never touched:
// they're already denominated in ₹, not in the ingredient's unit, so they
// don't change when the unit does.
const QTY_FIELDS = [
  "Opening Qty",
  "Closing Qty",
  "Week Inventory",
  "Day 1 Qty",
  "Day 2 Qty",
  "Day 3 Qty",
  "Day 4 Qty",
  "Day 5 Qty",
  "Day 6 Qty",
  "Day 7 Qty",
];
const PRICE_PER_UNIT_FIELDS = [
  "Opening Price",
  "Day 1 Price",
  "Day 2 Price",
  "Day 3 Price",
  "Day 4 Price",
  "Day 5 Price",
  "Day 6 Price",
  "Day 7 Price",
];

async function migrateIngredients() {
  const ingredients = await prisma.ingredient.findMany({
    select: { id: true, name: true, unit: true, quantity: true, pricePerUnit: true, reorderLevel: true },
  });
  let updated = 0;
  for (const ing of ingredients) {
    const info = classifyUnit(ing.unit);
    if (!info) {
      console.log(`  SKIP Ingredient #${ing.id} "${ing.name}" — unrecognized unit ${JSON.stringify(ing.unit)}`);
      continue;
    }
    const qty = ing.quantity != null ? toCanonicalQty(ing.quantity, ing.unit)!.qty : ing.quantity;
    const price = ing.pricePerUnit != null ? toCanonicalPricePerUnit(ing.pricePerUnit, ing.unit) : ing.pricePerUnit;
    const reorder = ing.reorderLevel != null ? toCanonicalQty(ing.reorderLevel, ing.unit)!.qty : ing.reorderLevel;
    await prisma.ingredient.update({
      where: { id: ing.id },
      data: { unit: info.canonical, quantity: qty, pricePerUnit: price, reorderLevel: reorder },
    });
    updated++;
  }
  console.log(`Ingredient: ${updated}/${ingredients.length} rows converted`);
}

async function migrateMenuItemIngredients() {
  const miis = await prisma.menuItemIngredient.findMany({
    select: { id: true, quantity: true, unit: true },
  });
  let updated = 0;
  for (const mii of miis) {
    const info = classifyUnit(mii.unit);
    if (!info) {
      console.log(`  SKIP MenuItemIngredient #${mii.id} — unrecognized unit ${JSON.stringify(mii.unit)}`);
      continue;
    }
    const converted = toCanonicalQty(mii.quantity, mii.unit)!;
    await prisma.menuItemIngredient.update({
      where: { id: mii.id },
      data: { unit: converted.unit, quantity: converted.qty },
    });
    updated++;
  }
  console.log(`MenuItemIngredient: ${updated}/${miis.length} rows converted`);
}

async function migrateRestocks() {
  const restocks = await prisma.inventoryRestock.findMany({ select: { id: true, data: true } });
  let updated = 0;
  for (const r of restocks) {
    const data = r.data as Record<string, any[]> | null;
    if (!data) continue;
    let anySkipped = false;
    for (const weekKey of Object.keys(data)) {
      data[weekKey] = (data[weekKey] || []).map((row: any) => {
        const info = classifyUnit(row["Unit"]);
        if (!info) {
          console.log(`  SKIP restock #${r.id} ${weekKey}/${row["Ingredient"]} — unrecognized unit ${JSON.stringify(row["Unit"])}`);
          anySkipped = true;
          return row;
        }
        const next = { ...row, Unit: info.canonical };
        for (const f of QTY_FIELDS) {
          if (next[f] != null) next[f] = Number(next[f]) * info.toCanonical;
        }
        for (const f of PRICE_PER_UNIT_FIELDS) {
          if (next[f] != null) next[f] = Number(next[f]) / info.toCanonical;
        }
        return next;
      });
    }
    await prisma.inventoryRestock.update({ where: { id: r.id }, data: { data } });
    updated++;
    if (anySkipped) console.log(`  (restock #${r.id} saved with some rows left unconverted)`);
  }
  console.log(`InventoryRestock: ${updated}/${restocks.length} records converted`);
}

async function migratePriceHistory() {
  // No unit field of its own — convert using each entry's ingredient's
  // current (pre-migration) unit, since oldPrice/newPrice were always
  // denominated in whatever the ingredient's unit was at that time.
  const entries = await prisma.ingredientPriceHistory.findMany({
    select: { id: true, ingredientId: true, oldPrice: true, newPrice: true },
  });
  if (entries.length === 0) {
    console.log("IngredientPriceHistory: 0 rows, nothing to do");
    return;
  }
  // We need the ORIGINAL (pre-migration) ingredient unit, but ingredients
  // are migrated in a separate step. Run this before migrateIngredients()
  // if there's ever real data here.
  console.log(`IngredientPriceHistory: ${entries.length} rows — implement before running if this is ever non-zero`);
}

async function main() {
  console.log("=== Running unit migration ===\n");
  await migratePriceHistory();
  await migrateIngredients();
  await migrateMenuItemIngredients();
  await migrateRestocks();
  console.log("\n=== Done ===");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
