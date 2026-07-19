import prisma from "../../config/prisma";

// ─── Add-On Groups (e.g. "Extra Toppings") ───────────────────────────────────

export const getAddOnGroupsService = async (restaurantId: number) => {
  return prisma.addOnGroup.findMany({
    where: { restaurantId, isDeleted: false },
    include: {
      options: { where: { isDeleted: false }, orderBy: { id: "asc" } },
      menuItems: { select: { menuItemId: true } },
    },
    orderBy: { name: "asc" },
  });
};

export const createAddOnGroupService = async (data: {
  restaurantId: number;
  name: string;
}) => {
  return prisma.addOnGroup.create({
    data: { restaurantId: data.restaurantId, name: data.name },
    include: { options: true },
  });
};

export const updateAddOnGroupService = async (id: number, name: string) => {
  return prisma.addOnGroup.update({ where: { id }, data: { name } });
};

export const deleteAddOnGroupService = async (id: number) => {
  return prisma.addOnGroup.update({ where: { id }, data: { isDeleted: true } });
};

// ─── Add-On Options (e.g. "Extra Cheese ₹40") ────────────────────────────────

export const createAddOnService = async (data: {
  addOnGroupId: number;
  name: string;
  price: number;
}) => {
  return prisma.addOn.create({
    data: {
      addOnGroupId: data.addOnGroupId,
      name: data.name,
      price: data.price,
    },
  });
};

export const updateAddOnService = async (
  id: number,
  data: { name?: string; price?: number },
) => {
  return prisma.addOn.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.price !== undefined ? { price: data.price } : {}),
    },
  });
};

export const deleteAddOnService = async (id: number) => {
  return prisma.addOn.update({ where: { id }, data: { isDeleted: true } });
};

// ─── Attaching groups to menu items ──────────────────────────────────────────

export const attachAddOnGroupService = async (
  menuItemId: number,
  addOnGroupId: number,
) => {
  return prisma.menuItemAddOnGroup.upsert({
    where: { menuItemId_addOnGroupId: { menuItemId, addOnGroupId } },
    update: {},
    create: { menuItemId, addOnGroupId },
  });
};

export const detachAddOnGroupService = async (
  menuItemId: number,
  addOnGroupId: number,
) => {
  return prisma.menuItemAddOnGroup.delete({
    where: { menuItemId_addOnGroupId: { menuItemId, addOnGroupId } },
  });
};

// Groups + options available for a specific menu item — what the POS shows
// when that item is added to the cart.
export const getMenuItemAddOnGroupsService = async (menuItemId: number) => {
  const links = await prisma.menuItemAddOnGroup.findMany({
    where: { menuItemId, addOnGroup: { isDeleted: false } },
    include: {
      addOnGroup: {
        include: {
          options: { where: { isDeleted: false }, orderBy: { id: "asc" } },
        },
      },
    },
  });
  return links.map((l) => l.addOnGroup);
};

// Bulk variant of the above, keyed by menuItemId — lets the POS prefetch
// every item's attached groups once per menu load instead of one request
// per item tapped.
export const getRestaurantAddOnAttachmentsService = async (
  restaurantId: number,
) => {
  const links = await prisma.menuItemAddOnGroup.findMany({
    where: { addOnGroup: { restaurantId, isDeleted: false } },
    include: {
      addOnGroup: {
        include: {
          options: { where: { isDeleted: false }, orderBy: { id: "asc" } },
        },
      },
    },
  });

  const map: Record<number, any[]> = {};
  for (const link of links) {
    if (!map[link.menuItemId]) map[link.menuItemId] = [];
    map[link.menuItemId].push(link.addOnGroup);
  }
  return map;
};
