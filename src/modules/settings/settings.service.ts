import prisma from "../../config/prisma";

export const getRestaurantSettingsService = async (restaurantId: number) => {
  return prisma.restaurant.findUnique({
    where: { id: restaurantId },
    include: {
      branches: {
        where: { isDeleted: false },
        include: { billing: true },
        orderBy: { createdAt: "asc" },
      },
      users: {
        where: { role: "OWNER" },
        select: { id: true, name: true, email: true, phone: true, role: true },
        take: 1,
      },
    },
  });
};

export const updateBranchesService = async (body: any) => {
  const { restaurantId, branches } = body;

  await Promise.all(
    branches.map((branch: any) => {
      const data = {
        name: branch.name || "",
        address: branch.address || null,
        phone: branch.phone || null,
        email: branch.email || null,
        city: branch.city || null,
        state: branch.state || null,
        pincode: branch.pincode || null,
        isDeleted: branch.isDeleted ?? false,
      };

      // New branches have no id or id is falsy — create them
      if (!branch.id || branch._isNew) {
        return prisma.branch.create({
          data: { restaurantId, ...data },
        });
      }

      return prisma.branch.update({
        where: { id: Number(branch.id) },
        data,
      });
    }),
  );

  return true;
};

export const createBranchService = async (restaurantId: number, data: any) => {
  return prisma.branch.create({
    data: {
      restaurantId,
      name: data.name || "New Branch",
      address: data.address || null,
      phone: data.phone || null,
      email: data.email || null,
      city: data.city || null,
      state: data.state || null,
      pincode: data.pincode || null,
    },
  });
};

export const updateGeneralSettingsService = async (
  restaurantId: number,
  body: any,
) => {
  const { name, phone, email, address, gstNumber } = body;
  return prisma.restaurant.update({
    where: { id: restaurantId },
    data: { name, phone, email, address, gstNumber },
  });
};
