import prisma from "../../config/prisma";

export const getMenuManagementService = async (restaurantId: number) => {
  const [menuItems, ingredients, categories, restocks] = await Promise.all([
    prisma.menuItem.findMany({
      where: {
        restaurantId,
        isDeleted: false,
      },

      include: {
        category: true,
      },

      orderBy: {
        createdAt: "desc",
      },
    }),

    prisma.ingredient.findMany({
      where: {
        restaurantId,
      },

      include: {
        category: true,
      },

      orderBy: {
        createdAt: "desc",
      },
    }),

    prisma.ingredientCategory.findMany({
      where: {
        restaurantId,
      },
    }),

    prisma.inventoryRestock.findMany({
      where: {
        restaurantId,
      },

      orderBy: {
        createdAt: "desc",
      },
    }),
  ]);

  return {
    menuItems,
    ingredients,
    categories,
    restocks,
  };
};

export const saveMenuItemMappingData = async (body: any) => {
  const { menuItemId, ingredients } = body;

  await prisma.menuItemIngredient.deleteMany({
    where: {
      menuItemId,
    },
  });

  if (ingredients?.length) {
    await prisma.menuItemIngredient.createMany({
      data: ingredients.map((item: any) => ({
        menuItemId,

        ingredientId: item.ingredientId,

        quantity: Number(item.quantity),

        unit: item.unit,

        wastage: Number(item.wastage || 0),
      })),
    });
  }

  return true;
};

export const getMenuItemMappingData = async (restaurantId: number) => {
  return await prisma.menuItem.findMany({
    where: {
      restaurantId,
    },

    include: {
      category: true,

      menuItemIngredients: {
        include: {
          ingredient: true,
        },
      },
    },
  });
};

export const saveRestockHistoryData = async (
  restaurantId: number,
  month: number,
  year: number,
  data: any,
) => {
  return prisma.inventoryRestock.upsert({
    where: {
      restaurantId_month_year: {
        restaurantId,
        month,
        year,
      },
    },

    update: {
      data,
    },

    create: {
      restaurantId,
      month,
      year,
      data,
    },
  });
};

export const getRestockHistoryData = async (restaurantId: number) => {
  return prisma.inventoryRestock.findMany({
    where: {
      restaurantId,
    },

    orderBy: {
      createdAt: "desc",
    },
  });
};
