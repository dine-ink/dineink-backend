import prisma from "../../config/prisma";

export const getRestaurantSettingsService = async (restaurantId: number) => {
  const restaurant = await prisma.restaurant.findUnique({
    where: {
      id: restaurantId,
    },

    include: {
      branches: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  return restaurant;
};

export const updateBranchesService = async (body: any) => {
  const { restaurantId, branches } = body;

  for (const branch of branches) {
    if (branch.id) {
      await prisma.branch.update({
        where: {
          id: branch.id,
        },

        data: {
          name: branch.name,

          address: branch.address,

          phone: branch.phone,
        },
      });
    } else {
      await prisma.branch.create({
        data: {
          restaurantId,

          name: branch.name,

          address: branch.address,

          phone: branch.phone,
        },
      });
    }
  }

  return true;
};

export const updateGeneralSettingsService = async (
  restaurantId: number,
  body: any,
) => {
  const { name, phone, email, address, gstNumber } = body;

  return prisma.restaurant.update({
    where: {
      id: restaurantId,
    },

    data: {
      name,

      phone,

      email,

      address,

      gstNumber,
    },
  });
};
