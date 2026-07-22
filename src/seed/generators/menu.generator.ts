import type { AddOn, AddOnGroup, MenuItem, MenuItemAddOnGroup, Prisma } from "../../../generated/prisma";
import type { SeedConfig } from "../config";
import type { SeedContext } from "../context";
import { type Db, randomFloat, randomInt } from "../utils";

export interface MenuSeedResult {
  menuItems: MenuItem[];
  addOnGroups: AddOnGroup[];
  addOns: AddOn[];
  menuItemAddOnGroups: MenuItemAddOnGroup[];
}

interface MenuCategoryProfile {
  names: string[];
  priceRange: [number, number];
  prepTimeRange: [number, number];
}

/** Name lists sized to exactly cover MENU_ALLOCATION below — sums to config.counts.menuItems (120). */
const MENU_CATEGORY_PROFILES: Record<string, MenuCategoryProfile> = {
  Starters: {
    priceRange: [120, 280],
    prepTimeRange: [10, 20],
    names: [
      "Veg Manchurian", "Paneer 65", "Gobi 65", "Chicken 65", "Chicken Lollipop",
      "Veg Spring Roll", "Paneer Tikka", "Chilli Paneer", "Chicken Tikka", "Crispy Corn",
      "Veg Cutlet", "Fish Finger",
    ],
  },
  Soups: {
    priceRange: [90, 180],
    prepTimeRange: [8, 15],
    names: ["Tomato Soup", "Sweet Corn Soup", "Hot & Sour Soup", "Manchow Soup", "Lemon Coriander Soup", "Chicken Clear Soup"],
  },
  "South Indian": {
    priceRange: [60, 180],
    prepTimeRange: [10, 20],
    names: [
      "Masala Dosa", "Plain Dosa", "Rava Dosa", "Onion Uthappam", "Idli (2 pcs)", "Mini Idli",
      "Medu Vada", "Pongal", "Sambar Vada", "Rava Idli", "Set Dosa", "Podi Dosa",
      "Chettinad Chicken Curry", "Curd Rice",
    ],
  },
  "North Indian": {
    priceRange: [150, 320],
    prepTimeRange: [15, 25],
    names: [
      "Paneer Butter Masala", "Dal Makhani", "Butter Chicken", "Chicken Curry", "Malai Kofta",
      "Shahi Paneer", "Aloo Gobi", "Chole Masala", "Rajma Masala", "Palak Paneer",
      "Kadai Paneer", "Mixed Veg Curry", "Tandoori Roti", "Butter Naan",
    ],
  },
  Chinese: {
    priceRange: [140, 280],
    prepTimeRange: [12, 20],
    names: [
      "Veg Fried Rice", "Chicken Fried Rice", "Veg Noodles", "Chicken Noodles", "Chilli Chicken",
      "Manchurian Gravy", "Veg Manchurian Gravy", "Schezwan Fried Rice", "American Chopsuey",
      "Honey Chilli Potato", "Kung Pao Chicken", "Chicken Manchurian",
    ],
  },
  Rice: {
    priceRange: [160, 320],
    prepTimeRange: [20, 30],
    names: ["Veg Biryani", "Chicken Biryani", "Mutton Biryani", "Egg Biryani", "Jeera Rice", "Curd Rice (Bowl)", "Ghee Rice", "Lemon Rice"],
  },
  Noodles: {
    priceRange: [130, 220],
    prepTimeRange: [12, 18],
    names: ["Hakka Noodles", "Schezwan Noodles", "Singapore Noodles", "Chicken Hakka Noodles", "Veg Chowmein", "Chicken Chowmein"],
  },
  Pizza: {
    priceRange: [220, 450],
    prepTimeRange: [15, 25],
    names: [
      "Margherita Pizza", "Farmhouse Pizza", "Paneer Tikka Pizza", "Chicken Tikka Pizza",
      "Peppy Paneer Pizza", "BBQ Chicken Pizza", "Veggie Supreme Pizza", "Cheese Burst Pizza",
    ],
  },
  Burger: {
    priceRange: [120, 220],
    prepTimeRange: [8, 15],
    names: ["Veg Burger", "Paneer Burger", "Chicken Burger", "Crispy Chicken Burger", "Cheese Burger", "Aloo Tikki Burger"],
  },
  Pasta: {
    priceRange: [180, 280],
    prepTimeRange: [15, 20],
    names: ["White Sauce Pasta", "Red Sauce Pasta", "Mixed Sauce Pasta", "Alfredo Pasta", "Arrabiata Pasta", "Cheese Pasta"],
  },
  Sandwich: {
    priceRange: [90, 180],
    prepTimeRange: [8, 12],
    names: ["Veg Grilled Sandwich", "Paneer Sandwich", "Chicken Sandwich", "Club Sandwich", "Cheese Sandwich", "Bombay Sandwich"],
  },
  Beverages: {
    priceRange: [50, 160],
    prepTimeRange: [3, 8],
    names: [
      "Masala Chai", "Filter Coffee", "Fresh Lime Soda", "Sweet Lassi", "Mango Lassi",
      "Cold Coffee", "Chocolate Milkshake", "Oreo Shake", "Buttermilk", "Virgin Mojito",
      "Iced Tea", "Fresh Orange Juice",
    ],
  },
  Desserts: {
    priceRange: [70, 150],
    prepTimeRange: [5, 10],
    names: ["Gulab Jamun", "Rasmalai", "Brownie", "Chocolate Mousse", "Gajar Halwa", "Jalebi"],
  },
  "Ice Cream": {
    priceRange: [60, 120],
    prepTimeRange: [2, 5],
    names: ["Vanilla Ice Cream", "Chocolate Ice Cream", "Butterscotch Ice Cream", "Strawberry Ice Cream"],
  },
};

const NON_VEG_KEYWORDS = ["chicken", "mutton", "fish", "prawn", "egg"];

function typeFor(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("egg")) return "EGG";
  return NON_VEG_KEYWORDS.some((kw) => lower.includes(kw)) ? "NON_VEG" : "VEG";
}

async function ensureMenuItems(db: Db, config: SeedConfig, ctx: SeedContext): Promise<MenuItem[]> {
  const existing = await db.menuItem.findMany({ where: { restaurantId: ctx.restaurant.id } });
  if (existing.length > 0) return existing;

  const categoryIdByName = new Map(ctx.categories.map((c) => [c.name, c.id]));
  const rows: Prisma.MenuItemCreateManyInput[] = [];

  for (const categoryName of config.menuCategories) {
    const profile = MENU_CATEGORY_PROFILES[categoryName];
    const categoryId = categoryIdByName.get(categoryName);
    if (!profile || !categoryId) continue;

    const [priceLow, priceHigh] = profile.priceRange;
    const [prepLow, prepHigh] = profile.prepTimeRange;

    for (const name of profile.names) {
      rows.push({
        name,
        description: `${name} - a ${categoryName} favorite`,
        price: Math.round(randomFloat(priceLow, priceHigh, 2) * 2) / 2, // round to nearest 0.5 rupee
        prepTime: randomInt(prepLow, prepHigh),
        restaurantId: ctx.restaurant.id,
        categoryId,
        type: typeFor(name),
        isAvailable: true,
      });
    }
  }

  return db.menuItem.createManyAndReturn({ data: rows });
}

// Reusable additive add-ons, each attached to every menu item in one category.
const ADD_ON_GROUPS: Array<{ name: string; menuCategory: string; options: Array<{ name: string; price: number }> }> = [
  {
    name: "Pizza Toppings",
    menuCategory: "Pizza",
    options: [
      { name: "Extra Cheese", price: 50 },
      { name: "Extra Paneer", price: 60 },
      { name: "Extra Olives", price: 35 },
      { name: "Extra Mushroom", price: 40 },
      { name: "Extra Capsicum", price: 30 },
    ],
  },
  {
    name: "Burger Add-ons",
    menuCategory: "Burger",
    options: [
      { name: "Extra Cheese Slice", price: 15 },
      { name: "Extra Patty", price: 45 },
      { name: "Extra Mayo", price: 10 },
      { name: "Fried Egg", price: 15 },
    ],
  },
  {
    name: "Pasta Extras",
    menuCategory: "Pasta",
    options: [
      { name: "Extra Cheese", price: 30 },
      { name: "Extra Chicken", price: 60 },
      { name: "Extra Veggies", price: 25 },
      { name: "Garlic Bread", price: 50 },
    ],
  },
  {
    name: "Beverage Add-ons",
    menuCategory: "Beverages",
    options: [
      { name: "Extra Espresso Shot", price: 20 },
      { name: "Whipped Cream", price: 15 },
      { name: "Extra Scoop of Ice Cream", price: 30 },
    ],
  },
  {
    name: "Ice Cream Toppings",
    menuCategory: "Ice Cream",
    options: [
      { name: "Chocolate Sauce", price: 20 },
      { name: "Sprinkles", price: 15 },
      { name: "Chopped Nuts", price: 25 },
      { name: "Extra Scoop", price: 40 },
    ],
  },
];

async function ensureAddOns(
  db: Db,
  restaurantId: number,
  menuItems: MenuItem[],
  categories: SeedContext["categories"],
): Promise<{ addOnGroups: AddOnGroup[]; addOns: AddOn[]; menuItemAddOnGroups: MenuItemAddOnGroup[] }> {
  const existingGroups = await db.addOnGroup.findMany({ where: { restaurantId } });
  if (existingGroups.length > 0) {
    const [addOns, menuItemAddOnGroups] = await Promise.all([
      db.addOn.findMany({ where: { addOnGroupId: { in: existingGroups.map((g) => g.id) } } }),
      db.menuItemAddOnGroup.findMany({ where: { addOnGroupId: { in: existingGroups.map((g) => g.id) } } }),
    ]);
    return { addOnGroups: existingGroups, addOns, menuItemAddOnGroups };
  }

  const categoryIdByName = new Map(categories.map((c) => [c.name, c.id]));
  const addOnGroups: AddOnGroup[] = [];
  const addOns: AddOn[] = [];
  const menuItemAddOnGroups: MenuItemAddOnGroup[] = [];

  for (const groupDef of ADD_ON_GROUPS) {
    const group = await db.addOnGroup.create({ data: { restaurantId, name: groupDef.name } });
    addOnGroups.push(group);

    const groupAddOns = await db.addOn.createManyAndReturn({
      data: groupDef.options.map((o) => ({ addOnGroupId: group.id, name: o.name, price: o.price })),
    });
    addOns.push(...groupAddOns);

    const categoryId = categoryIdByName.get(groupDef.menuCategory);
    const itemsInCategory = categoryId ? menuItems.filter((m) => m.categoryId === categoryId) : [];
    if (itemsInCategory.length > 0) {
      const links = await db.menuItemAddOnGroup.createManyAndReturn({
        data: itemsInCategory.map((item) => ({ menuItemId: item.id, addOnGroupId: group.id })),
      });
      menuItemAddOnGroups.push(...links);
    }
  }

  return { addOnGroups, addOns, menuItemAddOnGroups };
}

/**
 * Owns: MenuItem (config.counts.menuItems, spread across ctx.categories with
 * a price + prepTime), AddOnGroup, AddOn, and MenuItemAddOnGroup (attaching
 * a subset of add-on groups to a subset of menu items).
 *
 * Idempotent: generates the full menu once per restaurant (check-first, like
 * ingredients/vendors) rather than duplicating on every plain `npm run seed`.
 */
export async function generateMenu(db: Db, config: SeedConfig, ctx: SeedContext): Promise<MenuSeedResult> {
  const menuItems = await ensureMenuItems(db, config, ctx);
  const { addOnGroups, addOns, menuItemAddOnGroups } = await ensureAddOns(db, ctx.restaurant.id, menuItems, ctx.categories);
  return { menuItems, addOnGroups, addOns, menuItemAddOnGroups };
}
