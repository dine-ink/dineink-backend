import bcrypt from "bcryptjs";

import prisma from "../../config/prisma";

export const setupRestaurantService = async (userId: number, body: any) => {
  const { restaurant, branches, staff, categories } = body;

  // CREATE RESTAURANT

  const createdRestaurant = await prisma.restaurant.create({
    data: {
      name: restaurant.name,

      phone: restaurant.phone,

      email: restaurant.email,

      address: restaurant.address,

      gstNumber: restaurant.gst,

      logo: restaurant.logo,
    },
  });

  // UPDATE OWNER

  await prisma.user.update({
    where: {
      id: userId,
    },

    data: {
      restaurantId: createdRestaurant.id,
    },
  });

  // STORE CREATED BRANCHES

  const createdBranches: any[] = [];

  // CREATE BRANCHES

  for (const branch of branches) {
    const createdBranch = await prisma.branch.create({
      data: {
        restaurantId: createdRestaurant.id,

        name: branch.name,

        address: branch.address,

        phone: branch.phone,

        city: branch.city,

        state: branch.state,

        pincode: branch.pincode,
      },
    });
    if (branch.billing) {
      await prisma.billingSettings.create({
        data: {
          branchId: createdBranch.id,

          billingTypes: branch.billing.billingTypes,

          gstPercentage: Number(branch.billing.gstPercentage),

          serviceCharge: Number(branch.billing.serviceCharge),

          includeGST: branch.billing.includeGST,

          enableDiscount: branch.billing.enableDiscount,

          enableTips: branch.billing.enableTips,

          paymentMethods: branch.billing.paymentMethods,
        },
      });
    }
    createdBranches.push(createdBranch);

    // CREATE TABLES

    if (branch.tables?.length) {
      await prisma.restaurantTable.createMany({
        data: branch.tables.map((table: any) => ({
          restaurantId: createdRestaurant.id,

          branchId: createdBranch.id,

          name: table.name,

          capacity: Number(table.capacity),
        })),
      });
    }
  }

  // CREATE STAFF

  if (staff?.length) {
    for (const member of staff) {
      const assignedBranch =
        member.branchId !== undefined ? createdBranches[member.branchId] : null;

      const hashedPassword = await bcrypt.hash(member.password || "1234", 10);

      await prisma.user.create({
        data: {
          restaurantId: createdRestaurant.id,

          branchId: assignedBranch?.id || null,

          name: member.name,

          email: member.email,

          phone: member.phone,

          password: hashedPassword,

          role: member.role,

          hasLogin: member.hasLogin,

          salary: member.salary,

          joiningDate: member.joiningDate ? new Date(member.joiningDate) : null,

          shift: member.shift,

          department: member.department,

          employmentType: member.employmentType,

          monthlyWorkingHours: member.monthlyWorkingHours,
        },
      });
    }
  }
  // CREATE CATEGORIES & MENU ITEMS

  if (categories?.length) {
    for (const category of categories) {
      const createdCategory = await prisma.category.create({
        data: {
          restaurantId: createdRestaurant.id,

          name: category.name,

          icon: category.icon,
        },
      });

      // CREATE MENU ITEMS

      if (category.items?.length) {
        await prisma.menuItem.createMany({
          data: category.items.map((item: any) => ({
            restaurantId: createdRestaurant.id,

            categoryId: createdCategory.id,

            name: item.name,

            price: Number(item.price),

            type: item.type,
          })),
        });
      }
    }
  }
  return createdRestaurant;
};

export const getShopsService = async (userId: number) => {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },

    include: {
      restaurant: {
        include: {
          branches: true,
        },
      },
    },
  });

  return user?.restaurant;
};

export const getMyRestaurantService = async (userId: number) => {
  return prisma.user.findUnique({
    where: {
      id: userId,
    },

    include: {
      restaurant: {
        include: {
          menuItems: {
            include: {
              category: true,
            },
          },
          branches: true,
        },
      },

      branch: true,
    },
  });
};

export const getBranchDetailsService = async (branchId: number) => {
  return prisma.branch.findUnique({
    where: {
      id: branchId,
    },

    include: {
      restaurant: {
        include: {
          menuItems: true,
          categories: true,
        },
      },

      users: true,

      tables: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });
};

export const updateBranchDetailsService = async (
  branchId: number,
  body: any,
) => {
  const { name, address, phone } = body;

  return prisma.branch.update({
    where: {
      id: branchId,
    },

    data: {
      name,

      address,

      phone,
    },
  });
};

export const getRestaurantStaffData = async (restaurantId: number) => {
  return prisma.user.findMany({
    where: {
      restaurantId,
    },

    include: {
      branch: true,
    },

    orderBy: {
      createdAt: "desc",
    },
  });
};

export const getTablesService = async (
  restaurantId: number,
  branchId: number,
) => {
  return prisma.restaurantTable.findMany({
    where: {
      restaurantId,

      branchId,
    },

    orderBy: {
      createdAt: "asc",
    },
  });
};
