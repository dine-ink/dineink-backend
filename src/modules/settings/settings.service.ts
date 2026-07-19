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
        openingTime: branch.openingTime || null,
        closingTime: branch.closingTime || null,
        morningShiftHours: Number(branch.morningShiftHours) || 6,
        eveningShiftHours: Number(branch.eveningShiftHours) || 6,
        fullDayShiftHours: Number(branch.fullDayShiftHours) || 10,
        overtimeRateMultiplier: Number(branch.overtimeRateMultiplier) || 1.5,
        areaSqFt: branch.areaSqFt ? Number(branch.areaSqFt) : null,
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
  const branch = await prisma.branch.create({
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

  // Create billing settings if provided
  if (data.billing) {
    const b = data.billing;
    await prisma.billingSettings.create({
      data: {
        branchId: branch.id,
        billingTypes: b.billingTypes || [],
        gstPercentage: Number(b.gstPercentage) || 0,
        serviceCharge: Number(b.serviceCharge) || 0,
        includeGST: b.includeGST ?? false,
        enableDiscount: b.enableDiscount ?? true,
        enableTips: b.enableTips ?? false,
        paymentMethods: b.paymentMethods || [],
      },
    });
  }

  // Create tables if provided
  if (data.tables?.length) {
    await prisma.restaurantTable.createMany({
      data: data.tables.map((t: any) => ({
        restaurantId,
        branchId: branch.id,
        name: t.name,
        capacity: t.capacity || 4,
      })),
    });
  }

  return prisma.branch.findUnique({
    where: { id: branch.id },
    include: { billing: true },
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
