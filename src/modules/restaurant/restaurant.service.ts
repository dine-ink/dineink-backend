import bcrypt from "bcryptjs";
import prisma from "../../config/prisma";

export const setupRestaurantService = async (userId: number, body: any) => {
  const { restaurant, branches, staff, categories } = body;

  // Step 1: create restaurant + update owner (owner update depends on restaurantId)
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

  await prisma.user.update({
    where: { id: userId },
    data: { restaurantId: createdRestaurant.id },
  });

  // Step 2: branches + categories run in parallel (both only need restaurantId)
  const [createdBranches] = await Promise.all([
    Promise.all(
      (branches || []).map(async (branch: any) => {
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

        // billing settings + tables within this branch run in parallel
        await Promise.all([
          branch.billing
            ? prisma.billingSettings.create({
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
              })
            : Promise.resolve(null),
          branch.tables?.length
            ? prisma.restaurantTable.createMany({
                data: branch.tables.map((table: any) => ({
                  restaurantId: createdRestaurant.id,
                  branchId: createdBranch.id,
                  name: table.name,
                  capacity: Number(table.capacity),
                })),
              })
            : Promise.resolve(null),
        ]);

        return createdBranch;
      }),
    ),

    // categories run in parallel with branch creation
    Promise.all(
      (categories || []).map(async (category: any) => {
        const createdCategory = await prisma.category.create({
          data: {
            restaurantId: createdRestaurant.id,
            name: category.name,
            icon: category.icon,
          },
        });
        if (category.items?.length) {
          await prisma.menuItem.createMany({
            data: category.items.map((item: any) => ({
              restaurantId: createdRestaurant.id,
              categoryId: createdCategory.id,
              name: item.name,
              price: Number(item.price),
              type: item.type,
              prepTime: item.prepTime ? Number(item.prepTime) : 0,
            })),
          });
        }
        return createdCategory;
      }),
    ),
  ]);

  // Step 3: staff depends on createdBranches (for branch index mapping)
  if (staff?.length) {
    await Promise.all(
      staff.map(async (member: any) => {
        const assignedBranch =
          member.branchId !== undefined ? createdBranches[member.branchId] : null;
        const hashedPassword = await bcrypt.hash(member.password || "1234", 10);
        return prisma.user.create({
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
      }),
    );
  }

  return createdRestaurant;
};

export const getShopsService = async (userId: number) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      restaurant: {
        include: {
          branches: { include: { billing: true } },
        },
      },
    },
  });
  return user?.restaurant;
};

export const getMyRestaurantService = async (userId: number) => {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      restaurantId: true,
      branchId: true,
      hasLogin: true,
      isActive: true,
      salary: true,
      joiningDate: true,
      shift: true,
      employmentType: true,
      department: true,
      monthlyWorkingHours: true,
      restaurant: {
        include: {
          menuItems: {
            where: { isDeleted: false },
            select: {
              id: true,
              name: true,
              description: true,
              price: true,
              type: true,
              categoryId: true,
              isAvailable: true,
              prepTime: true,
              branchId: true,
              category: { select: { id: true, name: true, icon: true } },
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
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);

  // Branch data + top-selling items run in parallel
  const [branch, topItemsRaw] = await Promise.all([
    prisma.branch.findUnique({
      where: { id: branchId },
      include: {
        billing: true,
        restaurant: {
          include: {
            menuItems: {
              where: { isDeleted: false },
              select: {
                id: true,
                name: true,
                price: true,
                type: true,
                categoryId: true,
                isAvailable: true,
                prepTime: true,
              },
            },
            categories: true,
          },
        },
        users: {
          select: {
            id: true, name: true, email: true, phone: true,
            role: true, branchId: true, isActive: true,
            salary: true, department: true, shift: true,
            joiningDate: true, hasLogin: true,
          },
        },
        tables: { orderBy: { createdAt: "asc" } },
      },
    }),

    // DB-level aggregation — no need to load all bills into memory
    prisma.billItem.groupBy({
      by: ["itemName"],
      _sum: { quantity: true },
      where: {
        bill: { branchId, createdAt: { gte: startDate } },
      },
      orderBy: { _sum: { quantity: "desc" } },
      take: 10,
    }),
  ]);

  if (!branch) return null;

  const topSellingItems = topItemsRaw.map((item) => ({
    name: item.itemName,
    soldQuantity: item._sum.quantity || 0,
  }));

  return { ...branch, topSellingItems };
};

export const updateBranchDetailsService = async (branchId: number, body: any) => {
  const { name, address, phone, email, city, state, pincode, tables, billing } = body;

  // 1. Update branch fields
  await prisma.branch.update({
    where: { id: branchId },
    data: { name, address, phone, email: email || null, city: city || null, state: state || null, pincode: pincode || null },
  });

  // 2. Upsert billing settings
  if (billing) {
    await prisma.billingSettings.upsert({
      where: { branchId },
      create: {
        branchId,
        billingTypes: billing.billingTypes || [],
        gstPercentage: Number(billing.gstPercentage) || 0,
        serviceCharge: Number(billing.serviceCharge) || 0,
        includeGST: billing.includeGST ?? false,
        enableDiscount: billing.enableDiscount ?? true,
        enableTips: billing.enableTips ?? false,
        paymentMethods: billing.paymentMethods || [],
      },
      update: {
        billingTypes: billing.billingTypes || [],
        gstPercentage: Number(billing.gstPercentage) || 0,
        serviceCharge: Number(billing.serviceCharge) || 0,
        includeGST: billing.includeGST ?? false,
        enableDiscount: billing.enableDiscount ?? true,
        enableTips: billing.enableTips ?? false,
        paymentMethods: billing.paymentMethods || [],
      },
    });
  }

  // 3. Sync tables
  if (Array.isArray(tables)) {
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { restaurantId: true } });
    const restaurantId = branch!.restaurantId;

    const existingIds = (await prisma.restaurantTable.findMany({ where: { branchId }, select: { id: true } })).map(t => t.id);
    const incomingIds = tables.filter((t: any) => !t._isNew).map((t: any) => Number(t.id));

    // Delete tables removed by user
    const toDelete = existingIds.filter(id => !incomingIds.includes(id));
    if (toDelete.length) await prisma.restaurantTable.deleteMany({ where: { id: { in: toDelete } } });

    // Update existing tables
    await Promise.all(
      tables.filter((t: any) => !t._isNew).map((t: any) =>
        prisma.restaurantTable.update({ where: { id: Number(t.id) }, data: { name: t.name, capacity: t.capacity ? Number(t.capacity) : null } })
      )
    );

    // Create new tables
    const newTables = tables.filter((t: any) => t._isNew && t.name);
    if (newTables.length) {
      await prisma.restaurantTable.createMany({
        data: newTables.map((t: any) => ({ name: t.name, capacity: t.capacity ? Number(t.capacity) : null, status: "AVAILABLE", restaurantId, branchId })),
      });
    }
  }

  return prisma.branch.findUnique({ where: { id: branchId }, include: { billing: true } });
};

export const getRestaurantStaffData = async (
  restaurantId: number,
  branchId: number,
) => {
  return prisma.user.findMany({
    where: { restaurantId, branchId },
    select: {
      id: true, name: true, email: true, phone: true, role: true,
      isActive: true, isDeleted: true, salary: true, joiningDate: true,
      shift: true, employmentType: true, department: true,
      monthlyWorkingHours: true, hasLogin: true, createdAt: true,
      branch: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
};

export const getTablesService = async (restaurantId: number, branchId: number) => {
  return prisma.restaurantTable.findMany({
    where: { restaurantId, branchId },
    orderBy: { createdAt: "asc" },
  });
};

export const getRestaurantInsights = async (
  restaurantId: number,
  branchId: number,
) => {
  return prisma.restaurantInsights.findUnique({
    where: { restaurantId_branchId: { restaurantId, branchId } },
  });
};

export const createRestaurantTableService = async (body: any) => {
  // Run existence check + parent table lookup in parallel
  const [existing, parentTable] = await Promise.all([
    prisma.restaurantTable.findFirst({
      where: { name: body.name, branchId: body.branchId },
    }),
    body.isTemporary && body.tempTableType === "SPLIT"
      ? prisma.restaurantTable.findUnique({
          where: { id: Number(body.parentTableIds) },
        })
      : Promise.resolve(null),
  ]);

  if (existing) throw new Error("Table already exists");

  if (body.isTemporary && body.tempTableType === "SPLIT") {
    if (!parentTable) throw new Error("Parent table not found");
    if (Number(body.capacity) > (parentTable.capacity || 0)) {
      throw new Error("Not enough seats available");
    }
  }

  const table = await prisma.restaurantTable.create({
    data: {
      name: body.name,
      capacity: body.capacity,
      status: body.status || "AVAILABLE",
      isTemporary: body.isTemporary || false,
      tempTableType: body.tempTableType || null,
      parentTableIds: body.parentTableIds || null,
      restaurantId: Number(body.restaurantId),
      branch: { connect: { id: Number(body.branchId) } },
    },
  });

  if (body.isTemporary && body.tempTableType === "MERGE") {
    const parentIds = body.parentTableIds.split(",").map((id: string) => Number(id));
    await prisma.restaurantTable.updateMany({
      where: { id: { in: parentIds } },
      data: { status: "OCCUPIED" },
    });
  }

  if (body.isTemporary && body.tempTableType === "SPLIT" && parentTable) {
    await prisma.restaurantTable.update({
      where: { id: parentTable.id },
      data: { capacity: (parentTable.capacity || 0) - Number(body.capacity) },
    });
  }

  return table;
};

export const createStaffService = async (data: any) => {
  if (data.hasLogin && (!data.password || data.password.length < 6)) {
    throw new Error("Password must be at least 6 characters for staff with login access");
  }
  const hashedPassword = await bcrypt.hash(data.password || "1234", 10);
  return prisma.user.create({
    data: {
      restaurantId: data.restaurantId ? Number(data.restaurantId) : null,
      branchId:     data.branchId     ? Number(data.branchId)     : null,
      name: data.name,
      email: data.email || null,
      phone: data.phone || null,
      password: hashedPassword,
      role: data.role || "STAFF",
      hasLogin: data.hasLogin ?? false,
      salary: data.salary ? Number(data.salary) : null,
      joiningDate: data.joiningDate ? new Date(data.joiningDate) : null,
      shift: data.shift || null,
      department: data.department || null,
    },
  });
};

export const updateStaffService = async (userId: number, data: any) => {
  const updateData: any = {
    name: data.name,
    email: data.email || null,
    phone: data.phone || null,
    role: data.role || "STAFF",
    hasLogin: data.hasLogin ?? false,
    salary: data.salary ? Number(data.salary) : null,
    joiningDate: data.joiningDate ? new Date(data.joiningDate) : null,
    shift: data.shift || null,
    department: data.department || null,
    branchId: data.branchId ? Number(data.branchId) : null,
  };
  if (data.password) updateData.password = await bcrypt.hash(data.password, 10);
  return prisma.user.update({ where: { id: userId }, data: updateData });
};

export const deleteRestaurantTableService = async (id: number) => {
  // Check table existence + active order in parallel
  const [table, activeOrder] = await Promise.all([
    prisma.restaurantTable.findUnique({ where: { id } }),
    prisma.runningOrder.findFirst({ where: { tableId: id, status: "ACTIVE" } }),
  ]);

  if (!table) throw new Error("Table not found");
  if (activeOrder) throw new Error("Cannot delete active table");

  if (table.isTemporary && table.tempTableType === "SPLIT") {
    const parentId = Number(table.parentTableIds);
    const parentTable = await prisma.restaurantTable.findUnique({ where: { id: parentId } });
    if (parentTable) {
      await prisma.restaurantTable.update({
        where: { id: parentId },
        data: { capacity: (parentTable.capacity || 0) + (table.capacity || 0) },
      });
    }
  }

  if (table.isTemporary && table.tempTableType === "MERGE") {
    const parentIds =
      table.parentTableIds?.split(",").map((id: string) => Number(id)) || [];
    await prisma.restaurantTable.updateMany({
      where: { id: { in: parentIds } },
      data: { status: "AVAILABLE" },
    });
  }

  await prisma.restaurantTable.delete({ where: { id } });
  return true;
};

