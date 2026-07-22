import { subDays } from "date-fns";
import type { Ingredient, IngredientCategory, IngredientPriceHistory, Prisma } from "../../../generated/prisma";
import type { SeedConfig } from "../config";
import { chance, type Db, randomFloat, randomInt } from "../utils";

export interface IngredientSeedResult {
  categories: IngredientCategory[];
  ingredients: Ingredient[];
  priceHistory: IngredientPriceHistory[];
}

// Ingredient.unit is always stored canonical (see src/utils/units.ts:
// CANONICAL_UNIT = { mass: "Kg", volume: "Litre", count: "Piece"}) — every
// value below is already in that unit, not the "shopper" unit (grams,
// millilitres, etc.) a real entry screen would show.
type CanonicalUnit = "Kg" | "Litre" | "Piece";

interface CategoryProfile {
  names: string[];
  defaultUnit: CanonicalUnit;
  /** Per-canonical-unit price range, e.g. Rs/Kg or Rs/Litre or Rs/Piece. */
  priceRange: [number, number];
  /** Typical on-hand stock range in canonical units — also used as the reorder-level reference point. */
  stockRange: [number, number];
  /** Exact-name overrides for items that don't fit the category's default unit (e.g. bottled sauces within Groceries). */
  unitOverrides?: Record<string, CanonicalUnit>;
}

const CATEGORY_PROFILES: Record<string, CategoryProfile> = {
  Vegetables: {
    defaultUnit: "Kg",
    priceRange: [15, 90],
    stockRange: [5, 40],
    names: [
      "Onion", "Tomato", "Potato", "Carrot", "Cabbage", "Cauliflower", "French Beans",
      "Capsicum (Green)", "Capsicum (Red)", "Capsicum (Yellow)", "Brinjal", "Ladies Finger",
      "Garlic", "Ginger", "Green Chilli", "Red Chilli", "Coriander Leaves", "Mint Leaves",
      "Curry Leaves", "Spring Onion", "Cucumber", "Beetroot", "Radish", "Drumstick",
      "Green Peas", "Sweet Corn", "Spinach", "Bottle Gourd", "Ridge Gourd", "Pumpkin",
      "Sweet Potato", "Lemon", "Coconut", "Banana Stem", "Raw Banana", "Snake Gourd",
      "Ash Gourd", "Broccoli", "Baby Corn", "Mushroom",
    ],
  },
  Groceries: {
    defaultUnit: "Kg",
    priceRange: [25, 220],
    stockRange: [10, 60],
    unitOverrides: {
      "White Vinegar": "Litre",
      "Soy Sauce": "Litre",
      "Tomato Ketchup": "Litre",
      "Green Chilli Sauce": "Litre",
      "Red Chilli Sauce": "Litre",
      "Schezwan Sauce": "Litre",
      "Vinegar (Synthetic)": "Litre",
    },
    names: [
      "Basmati Rice", "Idli Rice", "Sona Masuri Rice", "Wheat Flour", "Maida", "Besan",
      "Rava", "Poha", "Sugar", "Jaggery", "Salt", "Rice Flour", "Vermicelli", "Bread",
      "Pasta", "Noodles (Hakka)", "Soya Chunks", "Toor Dal", "Moong Dal", "Chana Dal",
      "Urad Dal", "Masoor Dal", "Rajma", "Chole (Kabuli Chana)", "Baking Powder",
      "Baking Soda", "Cornflour", "Yeast", "White Vinegar", "Soy Sauce", "Tomato Ketchup",
      "Green Chilli Sauce", "Red Chilli Sauce", "Schezwan Sauce", "Vinegar (Synthetic)",
      "Peanuts",
    ],
  },
  Spices: {
    defaultUnit: "Kg",
    priceRange: [150, 1500],
    stockRange: [0.5, 5],
    names: [
      "Turmeric Powder", "Red Chilli Powder", "Coriander Powder", "Cumin Powder",
      "Garam Masala", "Chaat Masala", "Sambar Powder", "Rasam Powder", "Biryani Masala",
      "Pav Bhaji Masala", "Chana Masala", "Kitchen King Masala", "Mustard Seeds",
      "Cumin Seeds", "Fennel Seeds", "Fenugreek Seeds", "Asafoetida", "Black Pepper Powder",
      "Black Peppercorns", "Cardamom (Green)", "Cardamom (Black)", "Cloves",
      "Cinnamon Stick", "Bay Leaf", "Star Anise", "Dry Red Chilli", "Curry Powder",
      "Chilli Flakes", "Oregano", "Mixed Herbs", "Tandoori Masala", "Meat Masala",
      "Sabzi Masala", "Amchur Powder", "Kasuri Methi", "White Pepper",
    ],
  },
  Oil: {
    defaultUnit: "Litre",
    priceRange: [100, 450],
    stockRange: [5, 30],
    names: [
      "Sunflower Oil", "Groundnut Oil", "Gingelly Oil", "Coconut Oil", "Olive Oil",
      "Vanaspati", "Butter", "Ghee", "Palm Oil", "Rice Bran Oil", "Mustard Oil", "Margarine",
    ],
  },
  Milk: {
    defaultUnit: "Litre",
    priceRange: [45, 350],
    stockRange: [5, 40],
    names: [
      "Full Cream Milk", "Toned Milk", "Curd", "Buttermilk", "Fresh Cream",
      "Condensed Milk", "Milk Powder", "Skimmed Milk", "Whipping Cream", "Khoya",
      "Yogurt (Sweetened)", "Ice Cream Mix",
    ],
  },
  Cheese: {
    defaultUnit: "Kg",
    priceRange: [350, 700],
    stockRange: [2, 15],
    names: [
      "Mozzarella Cheese", "Cheddar Cheese", "Processed Cheese Slice", "Cheese Spread",
      "Parmesan Cheese", "Cream Cheese", "Pizza Cheese Blend", "Cheese Cubes",
      "Grated Cheese", "Nacho Cheese Sauce",
    ],
  },
  Paneer: {
    defaultUnit: "Kg",
    priceRange: [280, 420],
    stockRange: [2, 15],
    names: [
      "Fresh Paneer", "Malai Paneer", "Paneer Cubes", "Low-Fat Paneer",
      "Paneer Tikka Marinated", "Paneer Block (Bulk)",
    ],
  },
  Packaging: {
    defaultUnit: "Piece",
    priceRange: [1, 20],
    stockRange: [100, 1000],
    names: [
      "Parcel Box Small", "Parcel Box Medium", "Parcel Box Large", "Aluminium Foil Roll",
      "Cling Wrap Roll", "Paper Bags Small", "Paper Bags Large", "Plastic Carry Bags",
      "Disposable Plates", "Disposable Bowls", "Disposable Cups (Small)",
      "Disposable Cups (Large)", "Paper Napkins", "Straws", "Disposable Spoons",
      "Disposable Forks", "Butter Paper Sheets", "Food Wrap Sheets", "Sealing Tape Roll",
      "Container 250ml", "Container 500ml", "Container 750ml", "Container 1000ml",
      "Ice Cream Cups", "Wooden Stirrers", "Paper Trays", "Grease-Proof Paper",
      "Delivery Bags (Insulated)",
    ],
  },
  "Cleaning Supplies": {
    defaultUnit: "Piece",
    priceRange: [5, 300],
    stockRange: [5, 60],
    unitOverrides: {
      "Dishwash Liquid": "Litre",
      "Floor Cleaner": "Litre",
      "Toilet Cleaner": "Litre",
      "Glass Cleaner": "Litre",
      "Hand Wash": "Litre",
      "Sanitizer": "Litre",
      "Bleach": "Litre",
      "Drain Cleaner": "Litre",
    },
    names: [
      "Dishwash Liquid", "Dishwash Bar", "Floor Cleaner", "Toilet Cleaner", "Glass Cleaner",
      "Hand Wash", "Sanitizer", "Garbage Bags", "Scrub Pads", "Mop", "Broom",
      "Detergent Powder", "Bleach", "Air Freshener", "Disposable Gloves",
      "Tissue Paper Rolls", "Toilet Paper Rolls", "Kitchen Wipes", "Drain Cleaner",
      "Steel Scrubber",
    ],
  },
};

/** How config.counts.ingredients (200) splits across config.ingredientCategories — sums to 200 given the name lists above. */
const CATEGORY_ALLOCATION: Record<string, number> = {
  Vegetables: 40,
  Groceries: 36,
  Spices: 36,
  Oil: 12,
  Milk: 12,
  Cheese: 10,
  Paneer: 6,
  Packaging: 28,
  "Cleaning Supplies": 20,
};

async function ensureIngredientCategories(
  db: Db,
  config: SeedConfig,
  restaurantId: number,
): Promise<IngredientCategory[]> {
  const existing = await db.ingredientCategory.findMany({
    where: { restaurantId, name: { in: [...config.ingredientCategories] } },
  });
  const existingNames = new Set(existing.map((c) => c.name));
  const missing = config.ingredientCategories.filter((name) => !existingNames.has(name));
  if (missing.length === 0) return existing;

  const created = await db.ingredientCategory.createManyAndReturn({
    data: missing.map((name) => ({ name, restaurantId })),
  });
  return [...existing, ...created];
}

function buildIngredientRows(
  config: SeedConfig,
  restaurantId: number,
  categories: IngredientCategory[],
): Prisma.IngredientCreateManyInput[] {
  const categoryIdByName = new Map(categories.map((c) => [c.name, c.id]));
  const rows: Prisma.IngredientCreateManyInput[] = [];

  for (const categoryName of config.ingredientCategories) {
    const profile = CATEGORY_PROFILES[categoryName];
    const targetCount = CATEGORY_ALLOCATION[categoryName];
    const categoryId = categoryIdByName.get(categoryName);
    if (!profile || !targetCount || !categoryId) continue;

    const names = profile.names.slice(0, targetCount);
    const [priceLow, priceHigh] = profile.priceRange;
    const [, stockHigh] = profile.stockRange;

    for (const name of names) {
      const unit = profile.unitOverrides?.[name] ?? profile.defaultUnit;
      const pricePerUnit = randomFloat(priceLow, priceHigh, 2);

      // Reorder level is a policy threshold (~20-35% of a typical full
      // restock), independent of the random current-stock snapshot below —
      // ~12% of ingredients are seeded already below it, for a realistic
      // low-stock slice to test alerts against.
      const reorderLevel = Math.round(stockHigh * randomFloat(0.2, 0.35) * 100) / 100;
      const quantity = chance(0.12)
        ? randomFloat(0, reorderLevel * 0.9, 2)
        : randomFloat(reorderLevel * 1.1, stockHigh, 2);

      rows.push({
        name,
        restaurantId,
        categoryId,
        quantity,
        unit,
        // Total cost of the current on-hand quantity at today's per-unit price.
        purchasePrice: Math.round(pricePerUnit * quantity * 100) / 100,
        pricePerUnit,
        reorderLevel,
        isAiGenerated: false,
      });
    }
  }

  return rows;
}

/**
 * Owns: IngredientCategory (config.ingredientCategories), Ingredient
 * (config.counts.ingredients, spread across those categories with realistic
 * price/unit/reorderLevel), and each ingredient's baseline
 * IngredientPriceHistory row so later restocks have something to diff
 * against.
 *
 * Idempotent: Ingredient has no natural unique key, so this generates the
 * full set once per restaurant (if any already exist, they're returned
 * as-is) rather than duplicating on every plain `npm run seed`. Use --fresh
 * to regenerate from scratch.
 */
export async function generateIngredients(db: Db, config: SeedConfig, restaurantId: number): Promise<IngredientSeedResult> {
  const categories = await ensureIngredientCategories(db, config, restaurantId);

  const existingIngredients = await db.ingredient.findMany({ where: { restaurantId } });
  if (existingIngredients.length > 0) {
    const priceHistory = await db.ingredientPriceHistory.findMany({ where: { restaurantId } });
    return { categories, ingredients: existingIngredients, priceHistory };
  }

  const rows = buildIngredientRows(config, restaurantId, categories);
  const ingredients = await db.ingredient.createManyAndReturn({ data: rows });

  const priceHistoryRows: Prisma.IngredientPriceHistoryCreateManyInput[] = ingredients.map((ingredient) => ({
    ingredientId: ingredient.id,
    restaurantId,
    oldPrice: null,
    newPrice: ingredient.pricePerUnit ?? 0,
    createdAt: subDays(new Date(), randomInt(60, 150)),
  }));
  const priceHistory = await db.ingredientPriceHistory.createManyAndReturn({ data: priceHistoryRows });

  return { categories, ingredients, priceHistory };
}
