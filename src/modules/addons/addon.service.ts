import prisma from "../../config/prisma";
import { ForbiddenError } from "./addon.validation";

const findOwnedAddOnGroup = async (callerRestaurantId: number, id: number) => {
  const group = await prisma.addOnGroup.findUnique({ where: { id }, select: { restaurantId: true } });
  if (!group) throw new Error("Add-on group not found");
  if (group.restaurantId !== callerRestaurantId) throw new ForbiddenError("You do not have access to this add-on group");
};

const findOwnedAddOn = async (callerRestaurantId: number, id: number) => {
  const addOn = await prisma.addOn.findUnique({ where: { id }, select: { addOnGroup: { select: { restaurantId: true } } } });
  if (!addOn) throw new Error("Add-on not found");
  if (addOn.addOnGroup.restaurantId !== callerRestaurantId) throw new ForbiddenError("You do not have access to this add-on");
};

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

export const createAddOnGroupService = async (callerRestaurantId: number, data: {
  name: string;
}) => {
  return prisma.addOnGroup.create({
    data: { restaurantId: callerRestaurantId, name: data.name },
    include: { options: true },
  });
};

export const updateAddOnGroupService = async (callerRestaurantId: number, id: number, name: string) => {
  await findOwnedAddOnGroup(callerRestaurantId, id);
  return prisma.addOnGroup.update({ where: { id }, data: { name } });
};

export const deleteAddOnGroupService = async (callerRestaurantId: number, id: number) => {
  await findOwnedAddOnGroup(callerRestaurantId, id);
  return prisma.addOnGroup.update({ where: { id }, data: { isDeleted: true } });
};

// ─── Add-On Options (e.g. "Extra Cheese ₹40") ────────────────────────────────

export const createAddOnService = async (callerRestaurantId: number, data: {
  addOnGroupId: number;
  name: string;
  price: number;
}) => {
  await findOwnedAddOnGroup(callerRestaurantId, Number(data.addOnGroupId));
  return prisma.addOn.create({
    data: {
      addOnGroupId: data.addOnGroupId,
      name: data.name,
      price: data.price,
    },
  });
};

export const updateAddOnService = async (
  callerRestaurantId: number,
  id: number,
  data: { name?: string; price?: number },
) => {
  await findOwnedAddOn(callerRestaurantId, id);
  return prisma.addOn.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.price !== undefined ? { price: data.price } : {}),
    },
  });
};

export const deleteAddOnService = async (callerRestaurantId: number, id: number) => {
  await findOwnedAddOn(callerRestaurantId, id);
  return prisma.addOn.update({ where: { id }, data: { isDeleted: true } });
};

// ─── Attaching groups to menu items ──────────────────────────────────────────

const findOwnedMenuItemForAddOn = async (callerRestaurantId: number, menuItemId: number) => {
  const menuItem = await prisma.menuItem.findUnique({ where: { id: menuItemId }, select: { restaurantId: true } });
  if (!menuItem) throw new Error("Menu item not found");
  if (menuItem.restaurantId !== callerRestaurantId) throw new ForbiddenError("You do not have access to this menu item");
};

export const attachAddOnGroupService = async (
  callerRestaurantId: number,
  menuItemId: number,
  addOnGroupId: number,
) => {
  await Promise.all([
    findOwnedMenuItemForAddOn(callerRestaurantId, menuItemId),
    findOwnedAddOnGroup(callerRestaurantId, addOnGroupId),
  ]);
  return prisma.menuItemAddOnGroup.upsert({
    where: { menuItemId_addOnGroupId: { menuItemId, addOnGroupId } },
    update: {},
    create: { menuItemId, addOnGroupId },
  });
};

export const detachAddOnGroupService = async (
  callerRestaurantId: number,
  menuItemId: number,
  addOnGroupId: number,
) => {
  await findOwnedMenuItemForAddOn(callerRestaurantId, menuItemId);
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
