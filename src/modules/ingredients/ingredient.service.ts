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
  ingredients: any,
) => {
  await prisma.ingredient.deleteMany({
    where: {
      restaurantId,
    },
  });
  await prisma.ingredientCategory.deleteMany({
    where: {
      restaurantId,
    },
  });
  for (const categoryName in ingredients) {
    const category = await prisma.ingredientCategory.create({
      data: {
        name: categoryName,
        restaurantId,
      },
    });
    const items = ingredients[categoryName];
    for (const item of items) {
      await prisma.ingredient.create({
        data: {
          name: item.name,
          restaurantId,
          categoryId: category.id,
          quantity: item.quantity ? Number(item.quantity) : null,
          unit: item.unit,
          purchasePrice: item.purchasePrice ? Number(item.purchasePrice) : null,
          pricePerUnit: item.pricePerUnit ? Number(item.pricePerUnit) : null,
          isAiGenerated: true,
        },
      });
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

export const aiSuggestMappingData = async (body: any) => {
  const { menuItemName, ingredients } = body;
  const ingredientNames = ingredients.map((i: any) => i.name);
  const prompt = `
    You are a professional restaurant chef and recipe assistant.
    Your task is to identify ingredients required for the given menu item.
    Only use ingredients from the provided available ingredients list.
    Menu Item:
    ${menuItemName}
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
      },
      {
        "ingredientName": "Burger Bun",
        "quantity": 1,
        "unit": "Piece"
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
