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
          branches: {
            include: {
              billing: true,
            },
          },
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
  // ================= BRANCH DATA =================
  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },

    include: {
      billing: true,
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

  if (!branch) {
    return null;
  }

  // ================= LAST 30 DAYS =================
  const startDate = new Date();

  startDate.setDate(startDate.getDate() - 30);

  // ================= FETCH BILLS =================
  const bills = await prisma.bill.findMany({
    where: {
      restaurantId: branch.restaurantId,

      branchId: branch.id,

      createdAt: {
        gte: startDate,
      },
    },

    include: {
      items: true,
    },
  });

  // ================= ITEM MAP =================
  const itemMap: Record<
    number,
    {
      quantity: number;

      item: any;
    }
  > = {};

  bills.forEach((bill) => {
    bill.items.forEach((item) => {
      if (!item.menuItemId) {
        return;
      }
      if (!itemMap[item.menuItemId]) {
        const menuItem = branch.restaurant.menuItems.find(
          (m) => m.id === item.menuItemId,
        );

        itemMap[item.menuItemId] = {
          quantity: 0,

          item: menuItem,
        };
      }

      itemMap[item.menuItemId].quantity += item.quantity;
    });
  });

  // ================= TOP ITEMS =================
  const topSellingItems = Object.values(itemMap)
    .sort((a: any, b: any) => b.quantity - a.quantity)
    .slice(0, 10)
    .map((i: any) => ({
      ...i.item,

      soldQuantity: i.quantity,
    }));

  // ================= RETURN =================
  return {
    ...branch,

    topSellingItems,
  };
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

export const getRestaurantStaffData = async (
  restaurantId: number,
  branchId: number,
) => {
  return prisma.user.findMany({
    where: {
      restaurantId,
      branchId,
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

export const getRestaurantInsights = async (
  restaurantId: number,
  branchId: number,
) => {
  return prisma.restaurantInsights.findUnique({
    where: {
      restaurantId_branchId: {
        restaurantId,
        branchId,
      },
    },
  });
};
export const createRestaurantTableService = async (body: any) => {
  const existing = await prisma.restaurantTable.findFirst({
    where: {
      name: body.name,
      branchId: body.branchId,
    },
  });

  if (existing) {
    throw new Error("Table already exists");
  }

  // ================= GET PARENT TABLE =================
  let parentTable = null;

  if (body.isTemporary && body.tempTableType === "SPLIT") {
    parentTable = await prisma.restaurantTable.findUnique({
      where: {
        id: Number(body.parentTableIds),
      },
    });

    if (!parentTable) {
      throw new Error("Parent table not found");
    }

    // VALIDATION
    if (Number(body.capacity) > (parentTable.capacity || 0)) {
      throw new Error("Not enough seats available");
    }
  }

  // ================= CREATE TEMP TABLE =================
  const table = await prisma.restaurantTable.create({
    data: {
      name: body.name,

      capacity: body.capacity,

      status: body.status || "AVAILABLE",

      isTemporary: body.isTemporary || false,

      tempTableType: body.tempTableType || null,

      parentTableIds: body.parentTableIds || null,

      restaurantId: body.restaurantId,

      branchId: body.branchId,
    },
  });
  if (body.isTemporary && body.tempTableType === "MERGE") {
    const parentIds = body.parentTableIds
      .split(",")
      .map((id: string) => Number(id));

    await prisma.restaurantTable.updateMany({
      where: {
        id: {
          in: parentIds,
        },
      },

      data: {
        status: "OCCUPIED",
      },
    });
  }

  // ================= UPDATE PARENT TABLE =================
  if (body.isTemporary && body.tempTableType === "SPLIT" && parentTable) {
    await prisma.restaurantTable.update({
      where: {
        id: parentTable.id,
      },

      data: {
        capacity: (parentTable.capacity || 0) - Number(body.capacity),
      },
    });
  }

  return table;
};

export const deleteRestaurantTableService = async (id: number) => {
  const table = await prisma.restaurantTable.findUnique({
    where: { id },
  });

  if (!table) {
    throw new Error("Table not found");
  }

  // ================= CHECK ACTIVE ORDER =================
  const activeOrder = await prisma.runningOrder.findFirst({
    where: {
      tableId: id,
      status: "RUNNING",
    },
  });

  if (activeOrder) {
    throw new Error("Cannot delete active table");
  }

  // ================= RESTORE PARENT TABLE CAPACITY =================
  if (table.isTemporary && table.tempTableType === "SPLIT") {
    const parentId = Number(table.parentTableIds);
    const parentTable = await prisma.restaurantTable.findUnique({
      where: {
        id: parentId,
      },
    });

    if (parentTable) {
      await prisma.restaurantTable.update({
        where: {
          id: parentId,
        },

        data: {
          capacity: (parentTable.capacity || 0) + (table.capacity || 0),
        },
      });
    }
  }
  if (table.isTemporary && table.tempTableType === "MERGE") {
    const parentIds =
      table.parentTableIds?.split(",").map((id: string) => Number(id)) || [];

    await prisma.restaurantTable.updateMany({
      where: {
        id: {
          in: parentIds,
        },
      },

      data: {
        status: "AVAILABLE",
      },
    });
  }
  // ================= DELETE TEMP TABLE =================
  await prisma.restaurantTable.delete({
    where: { id },
  });

  return true;
};
