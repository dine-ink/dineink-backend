import openai from "../../config/openai";
import prisma from "../../config/prisma";
import { classifyUnit, toCanonicalQty, toCanonicalPricePerUnit } from "../../utils/units";

export const generateIngredients = async (restaurantId: number) => {
  const menuItems = await prisma.menuItem.findMany({
    where: { restaurantId },
    select: { name: true },
  });
  const menu = menuItems.map((item) => item.name);
  if (!menu.length) throw new Error("No menu items found");

  const prompt = `
  You are an expert restaurant inventory analyst.
  Based on these menu items:
  ${menu.join("\n")}
  Predict all likely ingredients used.
  Group ingredients ONLY into these categories:
  - Dairy
  - Meat
  - Vegetables
  - Spices
  - Oils
  - Sauces
  - Grains
  STRICT RULES:
  1. Return ONLY valid JSON
  2. No markdown
  3. No explanation
  4. No duplicate ingredients
  5. Ingredient must appear in ONLY ONE category
  6. Rice, flour, naan, wheat go under Grains
  7. Butter, paneer, milk, cream go under Dairy
  8. Onion, tomato, garlic, ginger go under Vegetables
  9. Masalas and powdered seasonings go under Spices
  10. Oils and ghee go under Oils
  Example:
  {
  "Dairy": ["Butter"],
  "Meat": ["Chicken"],
  "Vegetables": ["Onion"]
  }
  `;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });
  const content = response.choices[0].message.content || "{}";
  return JSON.parse(content);
};

export const saveIngredients = async (
  restaurantId: number,
  branchId: number,
  ingredients: any,
) => {
  const categoryNames = Object.keys(ingredients);

  // ── Phase 1: Batch-fetch then batch-create missing categories ───────────────
  const existingCategories = await prisma.ingredientCategory.findMany({
    where: { restaurantId, name: { in: categoryNames } },
  });
  const existingCategoryNames = new Set(existingCategories.map((c) => c.name));
  const missingCategoryNames = categoryNames.filter((n) => !existingCategoryNames.has(n));

  if (missingCategoryNames.length) {
    await prisma.ingredientCategory.createMany({
      data: missingCategoryNames.map((name) => ({ name, restaurantId })),
      skipDuplicates: true,
    });
  }

  const allCategories = await prisma.ingredientCategory.findMany({
    where: { restaurantId, name: { in: categoryNames } },
  });
  const categoryMap = new Map(allCategories.map((c) => [c.name, c.id]));

  // ── Phase 2: Collect all items, batch-fetch existing ingredients ────────────
  const allItems: Array<{ categoryName: string; item: any }> = [];
  for (const [categoryName, items] of Object.entries(ingredients)) {
    for (const item of items as any[]) {
      if (item.name?.trim()) allItems.push({ categoryName, item });
    }
  }

  const ingredientNames = allItems.map(({ item }) => item.name.trim());

  const existingIngredients = await prisma.ingredient.findMany({
    where: { restaurantId, name: { in: ingredientNames } },
    select: { id: true, name: true },
  });
  const existingMap = new Map(existingIngredients.map((i) => [i.name, i.id]));

  const toUpdate: any[] = [];
  const toCreate: any[] = [];

  for (const { categoryName, item } of allItems) {
    const categoryId = categoryMap.get(categoryName);
    const rawQuantity = item.quantity !== "" && item.quantity != null ? Number(item.quantity) : null;
    const purchasePrice = item.purchasePrice !== "" && item.purchasePrice != null ? Number(item.purchasePrice) : null;
    const rawPricePerUnit = item.pricePerUnit !== "" && item.pricePerUnit != null ? Number(item.pricePerUnit) : null;
    const rawReorderLevel = item.reorderLevel !== "" && item.reorderLevel != null ? Number(item.reorderLevel) : null;
    const name = item.name.trim();

    // Store everything in the canonical unit (Kg / Litre / Piece) regardless
    // of which unit the user picked when entering it.
    const enteredUnit = item.unit || "Kg";
    const canonicalQty = rawQuantity != null ? toCanonicalQty(rawQuantity, enteredUnit) : null;
    const unit = canonicalQty?.unit || classifyUnit(enteredUnit)?.canonical || "Kg";
    const quantity = canonicalQty ? canonicalQty.qty : rawQuantity;
    const pricePerUnit =
      rawPricePerUnit != null ? (toCanonicalPricePerUnit(rawPricePerUnit, enteredUnit) ?? rawPricePerUnit) : null;
    const reorderLevel =
      rawReorderLevel != null ? (toCanonicalQty(rawReorderLevel, enteredUnit)?.qty ?? rawReorderLevel) : null;

    if (existingMap.has(name)) {
      toUpdate.push({ id: existingMap.get(name), quantity, unit, purchasePrice, pricePerUnit, reorderLevel, categoryId });
    } else {
      toCreate.push({ name, restaurantId, categoryId, quantity, unit, purchasePrice, pricePerUnit, reorderLevel, isAiGenerated: true });
    }
  }

  // Run updates in parallel + batch-create new ones
  await Promise.all([
    ...toUpdate.map(({ id, ...data }) => prisma.ingredient.update({ where: { id }, data })),
    toCreate.length
      ? prisma.ingredient.createMany({ data: toCreate, skipDuplicates: true })
      : Promise.resolve(),
  ]);

  // ── Phase 3: Batch vendor mappings ──────────────────────────────────────────
  const vendorItems = allItems.filter(({ item }) => item.vendorId);
  if (vendorItems.length) {
    // Re-fetch to get IDs of newly created ingredients
    const freshIngredients = await prisma.ingredient.findMany({
      where: { restaurantId, name: { in: vendorItems.map(({ item }) => item.name.trim()) } },
      select: { id: true, name: true },
    });
    const ingredientIdMap = new Map(freshIngredients.map((i) => [i.name, i.id]));

    await Promise.all(
      vendorItems
        .map(({ item }) => ({
          ingredientId: ingredientIdMap.get(item.name.trim()),
          vendorId: Number(item.vendorId),
        }))
        .filter((m) => m.ingredientId)
        .map(({ ingredientId, vendorId }) =>
          prisma.ingredientVendor.upsert({
            where: { branchId_ingredientId: { branchId, ingredientId: ingredientId! } },
            update: { vendorId },
            create: { branchId, ingredientId: ingredientId!, vendorId },
          }),
        ),
    );
  }

  return true;
};

export const getIngredients = async (restaurantId: number) => {
  const categories = await prisma.ingredientCategory.findMany({
    where: { restaurantId },
    include: { ingredients: true },
    orderBy: { id: "asc" },
  });
  const formatted: any = {};
  for (const category of categories) {
    formatted[category.name] = category.ingredients.map((ingredient) => ({
      id: ingredient.id,
      name: ingredient.name,
      quantity: ingredient.quantity || "",
      unit: ingredient.unit || "Kg",
      purchasePrice: ingredient.purchasePrice || "",
      pricePerUnit: ingredient.pricePerUnit || "",
    }));
  }
  return formatted;
};

// Ingredient.reorderLevel has existed in the schema but nothing ever
// checked current stock against it — this actually surfaces the alert.
// Only ingredients with a reorder level set are evaluated; an unset
// (null) level means the owner hasn't configured a threshold yet, which
// is different from "0" and shouldn't be treated as an alert.
export const getReorderAlertsService = async (restaurantId: number) => {
  const ingredients = await prisma.ingredient.findMany({
    where: { restaurantId, reorderLevel: { not: null } },
    select: {
      id: true,
      name: true,
      quantity: true,
      unit: true,
      reorderLevel: true,
      category: { select: { name: true } },
    },
  });

  const alerts = ingredients
    .filter((i) => (i.quantity ?? 0) <= (i.reorderLevel ?? 0))
    .map((i) => {
      const quantity = i.quantity ?? 0;
      const reorderLevel = i.reorderLevel ?? 0;
      return {
        id: i.id,
        name: i.name,
        category: i.category?.name || "Uncategorized",
        quantity,
        unit: i.unit || "",
        reorderLevel,
        shortfall: Math.max(0, reorderLevel - quantity),
        severity: quantity <= 0 ? "OUT_OF_STOCK" : "LOW_STOCK",
      };
    })
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "OUT_OF_STOCK" ? -1 : 1;
      const aRatio = a.reorderLevel > 0 ? a.quantity / a.reorderLevel : 0;
      const bRatio = b.reorderLevel > 0 ? b.quantity / b.reorderLevel : 0;
      return aRatio - bRatio;
    });

  return {
    alerts,
    totalIngredientsTracked: ingredients.length,
    alertCount: alerts.length,
  };
};

export const aiSuggestMappingData = async (restaurantId: number, body: any) => {
  const { menuItemId } = body;

  const [menuItem, ingredients] = await Promise.all([
    prisma.menuItem.findFirst({
      where: { id: menuItemId, restaurantId },
    }),
    prisma.ingredient.findMany({
      where: { restaurantId },
      select: { id: true, name: true },
    }),
  ]);

  if (!menuItem) throw new Error("Menu item not found");

  const ingredientNames = ingredients.map((i) => i.name);

  const prompt = `
    You are a professional restaurant chef and recipe assistant.

    Your task is to identify ingredients required for the given menu item.

    Only use ingredients from the provided available ingredients list.

    Menu Item:
    ${menuItem.name}

    Available Ingredients:
    ${ingredientNames.join(", ")}

    Rules:
    - Suggest realistic restaurant recipe ingredients
    - Include bun, sauces, vegetables, cheese etc if commonly used
    - Use practical quantities
    - Return ONLY valid JSON array
    - No explanations

    Example:

    [
      {
        "ingredientName": "Paneer",
        "quantity": 120,
        "unit": "gm"
      }
    ]
    `;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
  });

  const responseText = completion.choices[0]?.message?.content || "[]";

  let parsed: any[] = [];
  try {
    const result = JSON.parse(responseText);
    if (Array.isArray(result)) parsed = result;
  } catch {
    parsed = [];
  }

  return parsed
    .map((item: any) => {
      const matchedIngredient = ingredients.find(
        (i) => i.name.toLowerCase() === item.ingredientName?.toLowerCase(),
      );
      return {
        ingredientId: matchedIngredient?.id,
        ingredient: matchedIngredient,
        quantity: item.quantity || 1,
        unit: item.unit || "gm",
        wastage: 0,
      };
    })
    .filter((i: any) => i.ingredientId);
};

export const uploadVendors = async (
  restaurantId: number,
  branchId: number,
  vendors: any[],
) => {
  const validVendors = vendors.filter((v) => v["Vendor Name"]?.trim());
  if (!validVendors.length) return true;

  const names = validVendors.map((v) => v["Vendor Name"].trim());

  // Batch-fetch existing vendors in one query
  const existing = await prisma.vendor.findMany({
    where: { restaurantId, branchId, name: { in: names } },
    select: { id: true, name: true },
  });
  const existingMap = new Map(existing.map((v) => [v.name, v.id]));

  await Promise.all([
    // Update existing vendors in parallel
    ...existing.map((v) => {
      const src = validVendors.find((vd) => vd["Vendor Name"].trim() === v.name);
      return prisma.vendor.update({
        where: { id: v.id },
        data: {
          address: src?.["Address"] || null,
          phone: src?.["Phone Number"] ? String(src["Phone Number"]) : null,
        },
      });
    }),
    // Create new vendors in one batch
    prisma.vendor.createMany({
      data: validVendors
        .filter((v) => !existingMap.has(v["Vendor Name"].trim()))
        .map((v) => ({
          restaurantId,
          branchId,
          name: v["Vendor Name"].trim(),
          address: v["Address"] || null,
          phone: v["Phone Number"] ? String(v["Phone Number"]) : null,
        })),
      skipDuplicates: true,
    }),
  ]);

  return true;
};

export const fetchVendorsData = async (restaurantId: number, branchId: number) => {
  return prisma.vendor.findMany({
    where: { restaurantId, branchId },
    orderBy: { name: "asc" },
  });
};

export const createVendor = async (data: {
  restaurantId: number;
  branchId: number;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  vendorType?: string;
}) => {
  return prisma.vendor.create({ data });
};

export const updateVendor = async (
  id: number,
  data: { name?: string; address?: string; phone?: string; email?: string; vendorType?: string },
  callerRestaurantId: number,
) => {
  const existing = await prisma.vendor.findUnique({ where: { id } });
  if (!existing || existing.restaurantId !== callerRestaurantId) {
    throw new Error("Vendor not found");
  }
  return prisma.vendor.update({ where: { id }, data });
};

export const deleteVendor = async (id: number, callerRestaurantId: number) => {
  const existing = await prisma.vendor.findUnique({ where: { id } });
  if (!existing || existing.restaurantId !== callerRestaurantId) {
    throw new Error("Vendor not found");
  }
  await prisma.ingredientVendor.deleteMany({ where: { vendorId: id } });
  return prisma.vendor.delete({ where: { id } });
};

export const getIngredientsByVendor = async (vendorId: number, callerRestaurantId: number) => {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor || vendor.restaurantId !== callerRestaurantId) {
    throw new Error("Vendor not found");
  }
  const rows = await prisma.ingredientVendor.findMany({
    where: { vendorId },
    include: { ingredient: { include: { category: true } } },
  });
  return rows
    .filter((r) => r.ingredient)
    .map((r) => ({
      id: r.ingredient!.id,
      name: r.ingredient!.name,
      category: r.ingredient!.category?.name || "Other",
      unit: r.ingredient!.unit,
      purchasePrice: r.ingredient!.purchasePrice,
      pricePerUnit: r.ingredient!.pricePerUnit,
      quantity: r.ingredient!.quantity,
    }));
};

// ── Ingredient price history ──────────────────────────────────────────────────

export const updateIngredientPrice = async (data: {
  ingredientId: number;
  restaurantId: number;
  newPrice: number;
  changedById?: number;
}) => {
  const ingredient = await prisma.ingredient.findUnique({
    where: { id: data.ingredientId },
    select: { pricePerUnit: true, restaurantId: true },
  });
  if (!ingredient || ingredient.restaurantId !== data.restaurantId) {
    throw new Error("Ingredient not found");
  }

  await prisma.ingredientPriceHistory.create({
    data: {
      ingredientId: data.ingredientId,
      restaurantId: data.restaurantId,
      oldPrice:     ingredient?.pricePerUnit ?? null,
      newPrice:     data.newPrice,
      changedById:  data.changedById,
    },
  });

  return prisma.ingredient.update({
    where: { id: data.ingredientId },
    data:  { pricePerUnit: data.newPrice },
  });
};

export const getIngredientPriceHistory = async (
  ingredientId: number,
  callerRestaurantId: number,
) => {
  return prisma.ingredientPriceHistory.findMany({
    // restaurantId is stamped on every history row at creation time — scoping
    // the read here means a caller can't page through another restaurant's
    // price history just by guessing ingredientIds.
    where:   { ingredientId, restaurantId: callerRestaurantId },
    orderBy: { createdAt: "desc" },
  });
};
