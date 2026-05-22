import prisma from "../../config/prisma";

export const getMenuManagementService = async (
  restaurantId: number,
  branchId?: number,
) => {
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
        ingredientVendors: {
          where: {
            branchId,
          },
          include: {
            vendor: true,
          },
        },
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

        ...(branchId && {
          branchId,
        }),
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

export const saveMenuItemMappingData = async (
  restaurantId: number,
  body: any,
) => {
  const { menuItemId, ingredients } = body;

  // VERIFY MENU ITEM

  const menuItem = await prisma.menuItem.findFirst({
    where: {
      id: menuItemId,
      restaurantId,
    },
  });

  if (!menuItem) {
    throw new Error("Menu item not found");
  }

  // VERIFY INGREDIENTS

  const ingredientIds = ingredients.map((i: any) => i.ingredientId);

  const validIngredients = await prisma.ingredient.findMany({
    where: {
      id: {
        in: ingredientIds,
      },

      restaurantId,
    },
  });

  if (validIngredients.length !== ingredientIds.length) {
    throw new Error("Invalid ingredients");
  }

  // DELETE OLD

  await prisma.menuItemIngredient.deleteMany({
    where: {
      menuItemId,
    },
  });

  // CREATE NEW

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
  branchId: number,
  month: number,
  year: number,
  data: any,
) => {
  return prisma.inventoryRestock.upsert({
    where: {
      restaurantId_branchId_month_year: {
        restaurantId,
        branchId,
        month,
        year,
      },
    },

    update: {
      data,
    },

    create: {
      restaurantId,
      branchId,
      month,
      year,
      data,
    },
  });
};

export const getRestockHistoryData = async (
  restaurantId: number,
  branchId?: number,
) => {
  return prisma.inventoryRestock.findMany({
    where: {
      restaurantId,

      ...(branchId && {
        branchId,
      }),
    },

    orderBy: {
      createdAt: "desc",
    },
  });
};
