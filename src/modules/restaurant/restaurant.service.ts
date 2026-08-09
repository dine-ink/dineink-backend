import bcrypt from "bcryptjs";
import prisma from "../../config/prisma";
import { generateToken } from "../../utils/generateToken/generateToken";
import { normalizeEmail } from "../../utils/email";
import { ForbiddenError } from "./restaurant.validation";

export const setupRestaurantService = async (userId: number, body: any) => {
  const { restaurant, branches, staff, categories } = body;

  // Same rule createStaffService enforces for staff added after setup — a
  // staff member with login access needs a real password, not the "1234"
  // placeholder below (which only exists to satisfy the NOT NULL column for
  // roster entries that can never log in, per hasLogin's check in auth.service.ts).
  for (const member of staff || []) {
    if (member.hasLogin && (!member.password || member.password.length < 6)) {
      throw new Error("Password must be at least 6 characters for staff with login access");
    }
  }

  // Pre-hash passwords before the transaction (CPU-intensive, not a DB call)
  const staffWithPasswords = await Promise.all(
    (staff || []).map(async (member: any) => ({
      ...member,
      email: normalizeEmail(member.email),
      hashedPassword: await bcrypt.hash(member.password || "1234", 10),
    })),
  );

  // Wrap everything in a transaction — if any step fails, all changes roll back
  const result = await prisma.$transaction(
    async (tx) => {
      // Step 1: create restaurant + link to owner
      const createdRestaurant = await tx.restaurant.create({
        data: {
          name: restaurant.name,
          phone: restaurant.phone,
          email: restaurant.email,
          address: restaurant.address,
          gstNumber: restaurant.gst,
          logo: restaurant.logo,
        },
      });

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: { restaurantId: createdRestaurant.id },
      });

      // Step 2: branches + categories in parallel (both only need restaurantId)
      const [createdBranches] = await Promise.all([
        Promise.all(
          (branches || []).map(async (branch: any) => {
            const createdBranch = await tx.branch.create({
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

            await Promise.all([
              branch.billing
                ? tx.billingSettings.create({
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
                ? tx.restaurantTable.createMany({
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

        Promise.all(
          (categories || []).map(async (category: any) => {
            const createdCategory = await tx.category.create({
              data: {
                restaurantId: createdRestaurant.id,
                name: category.name,
                icon: category.icon,
              },
            });
            if (category.items?.length) {
              await tx.menuItem.createMany({
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

      // Step 3: staff — uses pre-hashed passwords and maps branch index → branch id
      if (staffWithPasswords.length) {
        await Promise.all(
          staffWithPasswords.map(async (member: any) => {
            const assignedBranch =
              member.branchId !== undefined ? createdBranches[member.branchId] : null;
            return tx.user.create({
              data: {
                restaurantId: createdRestaurant.id,
                branchId: assignedBranch?.id || null,
                name: member.name,
                email: member.email,
                phone: member.phone,
                password: member.hashedPassword,
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

      return { restaurant: createdRestaurant, branches: createdBranches, user: updatedUser };
    },
    { timeout: 30000 },
  );

  // The signup token was minted before any restaurant/branch existed, so its
  // restaurantId claim is stale — issue a fresh one now that setup created
  // and linked them, otherwise the owner stays "restaurant-less" until they
  // log out and back in.
  const { password: _password, ...safeUser } = result.user;
  const token = generateToken({
    id: safeUser.id,
    email: safeUser.email,
    role: safeUser.role,
    restaurantId: safeUser.restaurantId,
    branchId: safeUser.branchId,
  });

  return {
    token,
    user: safeUser,
    restaurant: result.restaurant,
    branches: result.branches,
  };
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
        bill: { branchId, createdAt: { gte: startDate }, status: "PAID" },
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

export const createRestaurantTableService = async (callerRestaurantId: number, body: any) => {
  // The target branch must belong to the caller's own restaurant — otherwise
  // an authenticated user at Restaurant A could create a table on a branch
  // belonging to Restaurant B just by supplying a different branchId.
  const branch = await prisma.branch.findUnique({ where: { id: Number(body.branchId) }, select: { restaurantId: true } });
  if (!branch || branch.restaurantId !== callerRestaurantId) throw new ForbiddenError("You do not have access to this branch");

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
    if (parentTable.restaurantId !== callerRestaurantId) throw new ForbiddenError("You do not have access to this table");
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
      // Never trust a client-supplied restaurantId — always the caller's own.
      restaurantId: callerRestaurantId,
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

export const createStaffService = async (callerRestaurantId: number, data: any) => {
  if (data.hasLogin && (!data.password || data.password.length < 6)) {
    throw new Error("Password must be at least 6 characters for staff with login access");
  }
  // A staff member's branch, if given, must belong to the caller's own
  // restaurant — never trust a client-supplied restaurantId for the new hire.
  if (data.branchId) {
    const branch = await prisma.branch.findUnique({ where: { id: Number(data.branchId) }, select: { restaurantId: true } });
    if (!branch || branch.restaurantId !== callerRestaurantId) throw new ForbiddenError("You do not have access to this branch");
  }
  const hashedPassword = await bcrypt.hash(data.password || "1234", 10);
  return prisma.user.create({
    data: {
      restaurantId: callerRestaurantId,
      branchId:     data.branchId     ? Number(data.branchId)     : null,
      name: data.name,
      email: normalizeEmail(data.email) || null,
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

export const updateStaffService = async (callerRestaurantId: number, userId: number, data: any) => {
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { restaurantId: true } });
  if (!target || target.restaurantId !== callerRestaurantId) throw new ForbiddenError("You do not have access to this staff member");
  if (data.branchId) {
    const branch = await prisma.branch.findUnique({ where: { id: Number(data.branchId) }, select: { restaurantId: true } });
    if (!branch || branch.restaurantId !== callerRestaurantId) throw new ForbiddenError("You do not have access to this branch");
  }
  const updateData: any = {
    name: data.name,
    email: normalizeEmail(data.email) || null,
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

export const deleteRestaurantTableService = async (callerRestaurantId: number, id: number) => {
  // Check table existence + active order in parallel
  const [table, activeOrder] = await Promise.all([
    prisma.restaurantTable.findUnique({ where: { id } }),
    prisma.runningOrder.findFirst({ where: { tableId: id, status: "ACTIVE" } }),
  ]);

  if (!table) throw new Error("Table not found");
  if (table.restaurantId !== callerRestaurantId) throw new ForbiddenError("You do not have access to this table");
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

// ── Category CRUD ────────────────────────────────────────────────────────────

export const getCategoriesService = async (restaurantId: number) => {
  return prisma.category.findMany({
    where: { restaurantId, isDeleted: false },
    orderBy: { createdAt: "asc" },
  });
};

export const createCategoryService = async (callerRestaurantId: number, data: { name: string; icon?: string }) => {
  return prisma.category.create({
    data: { restaurantId: callerRestaurantId, name: data.name, icon: data.icon || null },
  });
};

const findOwnedCategory = async (callerRestaurantId: number, id: number) => {
  const category = await prisma.category.findUnique({ where: { id }, select: { restaurantId: true } });
  if (!category) throw new Error("Category not found");
  if (category.restaurantId !== callerRestaurantId) throw new ForbiddenError("You do not have access to this category");
};

export const updateCategoryService = async (callerRestaurantId: number, id: number, data: { name?: string; icon?: string }) => {
  await findOwnedCategory(callerRestaurantId, id);
  return prisma.category.update({
    where: { id },
    data: { name: data.name, icon: data.icon },
  });
};

export const deleteCategoryService = async (callerRestaurantId: number, id: number) => {
  await findOwnedCategory(callerRestaurantId, id);
  return prisma.category.update({ where: { id }, data: { isDeleted: true } });
};

// ── MenuItem CRUD ────────────────────────────────────────────────────────────

export const createMenuItemService = async (callerRestaurantId: number, data: any) => {
  if (data.categoryId) await findOwnedCategory(callerRestaurantId, Number(data.categoryId));
  if (data.branchId) {
    const branch = await prisma.branch.findUnique({ where: { id: Number(data.branchId) }, select: { restaurantId: true } });
    if (!branch || branch.restaurantId !== callerRestaurantId) throw new ForbiddenError("You do not have access to this branch");
  }
  return prisma.menuItem.create({
    data: {
      restaurantId: callerRestaurantId,
      branchId:     data.branchId     ? Number(data.branchId)     : null,
      categoryId:   data.categoryId   ? Number(data.categoryId)   : null,
      name:         data.name,
      description:  data.description  || null,
      price:        Number(data.price),
      type:         data.type         || null,
      prepTime:     data.prepTime     ? Number(data.prepTime)     : 0,
      isAvailable:  data.isAvailable  ?? true,
    },
    include: { category: true },
  });
};

const findOwnedMenuItem = async (callerRestaurantId: number, id: number) => {
  const menuItem = await prisma.menuItem.findUnique({ where: { id }, select: { restaurantId: true } });
  if (!menuItem) throw new Error("Menu item not found");
  if (menuItem.restaurantId !== callerRestaurantId) throw new ForbiddenError("You do not have access to this menu item");
};

export const updateMenuItemService = async (callerRestaurantId: number, id: number, data: any) => {
  await findOwnedMenuItem(callerRestaurantId, id);
  if (data.categoryId) await findOwnedCategory(callerRestaurantId, Number(data.categoryId));
  const update: any = {};
  if (data.name       !== undefined) update.name        = data.name;
  if (data.description !== undefined) update.description = data.description || null;
  if (data.price      !== undefined) update.price       = Number(data.price);
  if (data.type       !== undefined) update.type        = data.type;
  if (data.categoryId !== undefined) update.categoryId  = data.categoryId ? Number(data.categoryId) : null;
  if (data.prepTime   !== undefined) update.prepTime    = Number(data.prepTime);
  if (data.isAvailable !== undefined) update.isAvailable = Boolean(data.isAvailable);

  // Must mirror the same include as the menu-management list load — that
  // load includes menuItemIngredients, so if this response omits it,
  // MenuManagement.tsx's merge-into-local-state silently drops the item's
  // ingredient mapping (and its food-cost analytics) until a full reload.
  return prisma.menuItem.update({
    where: { id },
    data: update,
    include: {
      category: true,
      menuItemIngredients: {
        include: { ingredient: { include: { category: true } } },
      },
    },
  });
};

export const deleteMenuItemService = async (callerRestaurantId: number, id: number) => {
  await findOwnedMenuItem(callerRestaurantId, id);
  return prisma.menuItem.update({ where: { id }, data: { isDeleted: true } });
};

