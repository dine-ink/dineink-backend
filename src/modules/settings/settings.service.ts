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

  await Promise.all(
    branches.map((branch: any) =>
      branch.id
        ? prisma.branch.update({
            where: { id: branch.id },
            data: { name: branch.name, address: branch.address, phone: branch.phone },
          })
        : prisma.branch.create({
            data: { restaurantId, name: branch.name, address: branch.address, phone: branch.phone },
          }),
    ),
  );

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
