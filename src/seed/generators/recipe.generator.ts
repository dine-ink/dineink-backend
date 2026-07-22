import type { Ingredient, MenuItemIngredient, Prisma } from "../../../generated/prisma";
import type { SeedConfig } from "../config";
import type { SeedContext } from "../context";
import { type Db, randomFloat, randomInt, sampleUnique } from "../utils";

/** Which ingredient categories are plausible for a dish in a given menu category — Packaging/Cleaning Supplies never appear here, they're not food. */
const MENU_TO_INGREDIENT_CATEGORIES: Record<string, string[]> = {
  Starters: ["Vegetables", "Spices", "Oil", "Groceries", "Paneer"],
  Soups: ["Vegetables", "Spices", "Groceries", "Oil"],
  "South Indian": ["Groceries", "Vegetables", "Spices", "Oil", "Milk"],
  "North Indian": ["Vegetables", "Spices", "Oil", "Groceries", "Paneer", "Milk"],
  Chinese: ["Vegetables", "Spices", "Groceries", "Oil"],
  Rice: ["Groceries", "Vegetables", "Spices", "Oil"],
  Noodles: ["Groceries", "Vegetables", "Spices", "Oil"],
  Pizza: ["Groceries", "Cheese", "Vegetables", "Oil"],
  Burger: ["Groceries", "Vegetables", "Cheese", "Oil", "Paneer"],
  Pasta: ["Groceries", "Cheese", "Vegetables", "Oil", "Milk"],
  Sandwich: ["Groceries", "Vegetables", "Cheese", "Oil"],
  Beverages: ["Milk", "Groceries"],
  Desserts: ["Milk", "Groceries", "Oil"],
  "Ice Cream": ["Milk", "Groceries"],
};

function roundForUnit(qty: number, unit: string): number {
  if (unit === "Piece") return Math.max(1, Math.round(qty));
  return Math.round(qty * 1000) / 1000;
}

/**
 * Owns: MenuItemIngredient — links each menu item to 3-6 ctx.ingredients
 * with a quantity/unit/wastage, sized so the summed ingredient cost lands
 * near config.analytics.targetFoodCostPct of that item's price (with some
 * per-item spread — target cost % is itself randomized 22-38% around the
 * 30% target rather than exact, so the average lands near the target
 * without every item costing out identically).
 *
 * Idempotent: generates once per restaurant, checked via a plain count()
 * since MenuItemIngredient has no natural unique key.
 */
export async function generateRecipes(db: Db, config: SeedConfig, ctx: SeedContext): Promise<MenuItemIngredient[]> {
  const existingCount = await db.menuItemIngredient.count({ where: { menuItem: { restaurantId: ctx.restaurant.id } } });
  if (existingCount > 0) {
    return db.menuItemIngredient.findMany({ where: { menuItem: { restaurantId: ctx.restaurant.id } } });
  }

  const menuCategoryNameById = new Map(ctx.categories.map((c) => [c.id, c.name]));
  const ingredientCategoryNameById = new Map(ctx.ingredientCategories.map((c) => [c.id, c.name]));

  const ingredientsByCategory = new Map<string, Ingredient[]>();
  for (const ingredient of ctx.ingredients) {
    const name = ingredient.categoryId ? ingredientCategoryNameById.get(ingredient.categoryId) : undefined;
    if (!name) continue;
    ingredientsByCategory.set(name, [...(ingredientsByCategory.get(name) ?? []), ingredient]);
  }

  const rows: Prisma.MenuItemIngredientCreateManyInput[] = [];

  for (const menuItem of ctx.menuItems) {
    const menuCategoryName = menuItem.categoryId ? menuCategoryNameById.get(menuItem.categoryId) : undefined;
    const eligibleCategories = menuCategoryName ? MENU_TO_INGREDIENT_CATEGORIES[menuCategoryName] : undefined;
    if (!eligibleCategories) continue;

    const pool = eligibleCategories.flatMap((cat) => ingredientsByCategory.get(cat) ?? []);
    if (pool.length === 0) continue;

    const chosen = sampleUnique(pool, randomInt(3, 6));
    const targetCost = menuItem.price * randomFloat(0.22, 0.38, 3);

    const weights = chosen.map(() => randomFloat(0.5, 1.5, 3));
    const weightSum = weights.reduce((a, b) => a + b, 0);

    chosen.forEach((ingredient, i) => {
      const costShare = targetCost * (weights[i] / weightSum);
      const unit = ingredient.unit || "Kg";
      const quantity = roundForUnit(costShare / (ingredient.pricePerUnit || 1), unit);

      rows.push({
        menuItemId: menuItem.id,
        ingredientId: ingredient.id,
        quantity,
        unit,
        wastage: roundForUnit(quantity * randomFloat(0.02, 0.08), unit),
      });
    });
  }

  return db.menuItemIngredient.createManyAndReturn({ data: rows });
}
