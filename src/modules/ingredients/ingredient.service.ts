import openai from "../../config/openai";
import prisma from "../../config/prisma";

export const generateIngredients = async (restaurantId: number) => {
  const menuItems = await prisma.menuItem.findMany({
    where: {
      restaurantId,
    },
    select: {
      name: true,
    },
  });
  const menu = menuItems.map((item) => item.name);
  if (!menu.length) {
    throw new Error("No menu items found");
  }
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
    model: "gpt-5.4-mini",
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });
  const content = response.choices[0].message.content || "{}";
  return JSON.parse(content);
};

export const saveIngredients = async (
  restaurantId: number,
  branchId: number,
  ingredients: any,
) => {
  for (const categoryName in ingredients) {
    let category = await prisma.ingredientCategory.findFirst({
      where: {
        restaurantId,
        name: categoryName,
      },
    });

    /* =====================================================
       CREATE CATEGORY
    ===================================================== */

    if (!category) {
      category = await prisma.ingredientCategory.create({
        data: {
          name: categoryName,
          restaurantId,
        },
      });
    }

    const items = ingredients[categoryName];

    for (const item of items) {
      if (!item.name || item.name.trim() === "") {
        continue;
      }

      /* =====================================================
         NUMBER CONVERSION
      ===================================================== */

      const quantity =
        item.quantity !== "" && item.quantity !== null
          ? Number(item.quantity)
          : null;

      const purchasePrice =
        item.purchasePrice !== "" && item.purchasePrice !== null
          ? Number(item.purchasePrice)
          : null;

      const pricePerUnit =
        item.pricePerUnit !== "" && item.pricePerUnit !== null
          ? Number(item.pricePerUnit)
          : null;

      /* =====================================================
         FIND EXISTING INGREDIENT
      ===================================================== */

      const existingIngredient = await prisma.ingredient.findFirst({
        where: {
          restaurantId,
          name: item.name.trim(),
        },
      });

      let ingredient: any;

      /* =====================================================
         UPDATE INGREDIENT
      ===================================================== */

      if (existingIngredient) {
        ingredient = await prisma.ingredient.update({
          where: {
            id: existingIngredient.id,
          },

          data: {
            quantity,
            unit: item.unit || "Kg",
            purchasePrice,
            pricePerUnit,
            categoryId: category.id,
          },
        });
      } else {

      /* =====================================================
         CREATE INGREDIENT
      ===================================================== */
        ingredient = await prisma.ingredient.create({
          data: {
            name: item.name.trim(),

            restaurantId,

            categoryId: category.id,

            quantity,

            unit: item.unit || "Kg",

            purchasePrice,

            pricePerUnit,

            isAiGenerated: true,
          },
        });
      }

      /* =====================================================
         SAVE BRANCH VENDOR MAPPING
      ===================================================== */

      if (item.vendorId) {
        await prisma.ingredientVendor.upsert({
          where: {
            branchId_ingredientId: {
              branchId,
              ingredientId: ingredient.id,
            },
          },

          update: {
            vendorId: Number(item.vendorId),
          },

          create: {
            branchId,

            ingredientId: ingredient.id,

            vendorId: Number(item.vendorId),
          },
        });
      }
    }
  }

  return true;
};
export const getIngredients = async (restaurantId: number) => {
  const categories = await prisma.ingredientCategory.findMany({
    where: {
      restaurantId,
    },
    include: {
      ingredients: true,
    },
    orderBy: {
      id: "asc",
    },
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

export const aiSuggestMappingData = async (restaurantId: number, body: any) => {
  const { menuItemId } = body;

  // GET MENU ITEM

  const menuItem = await prisma.menuItem.findFirst({
    where: {
      id: menuItemId,
      restaurantId,
    },
  });

  if (!menuItem) {
    throw new Error("Menu item not found");
  }

  // GET RESTAURANT INGREDIENTS

  const ingredients = await prisma.ingredient.findMany({
    where: {
      restaurantId,
    },
  });

  const ingredientNames = ingredients.map((i: any) => i.name);

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
    model: "gpt-4.1-mini",

    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],

    temperature: 0.3,
  });

  const responseText = completion.choices[0]?.message?.content || "[]";

  let parsed: any[] = [];

  try {
    parsed = JSON.parse(responseText);
  } catch (err) {
    console.log("JSON Parse Error", err);

    parsed = [];
  }

  const mapped = parsed.map((item: any) => {
    const matchedIngredient = ingredients.find(
      (i: any) => i.name.toLowerCase() === item.ingredientName?.toLowerCase(),
    );

    return {
      ingredientId: matchedIngredient?.id,

      ingredient: matchedIngredient,

      quantity: item.quantity || 1,

      unit: item.unit || "gm",

      wastage: 0,
    };
  });

  return mapped.filter((i: any) => i.ingredientId);
};

export const uploadVendors = async (
  restaurantId: number,
  branchId: number,
  vendors: any[],
) => {
  for (const vendor of vendors) {
    if (!vendor["Vendor Name"]) {
      continue;
    }

    const existing = await prisma.vendor.findFirst({
      where: {
        restaurantId,
        branchId,
        name: vendor["Vendor Name"].trim(),
      },
    });

    if (existing) {
      await prisma.vendor.update({
        where: {
          id: existing.id,
        },

        data: {
          address: vendor["Address"] || null,

          phone: vendor["Phone Number"] ? String(vendor["Phone Number"]) : null,
        },
      });
    } else {
      await prisma.vendor.create({
        data: {
          restaurantId,
          branchId,

          name: vendor["Vendor Name"].trim(),

          address: vendor["Address"] || null,

          phone: vendor["Phone Number"] ? String(vendor["Phone Number"]) : null,
        },
      });
    }
  }

  return true;
};

export const fetchVendorsData = async (
  restaurantId: number,
  branchId: number,
) => {
  return prisma.vendor.findMany({
    where: {
      restaurantId,
      branchId,
    },

    orderBy: {
      name: "asc",
    },
  });
};
