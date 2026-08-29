import prisma from "../../../config/prisma";
import { updateMenuItemService } from "../../restaurant/restaurant.service";
import { AUDIT_ACTIONS, auditData, pick } from "../audit/audit.service";
import { notFound } from "../shared/apiError";

/**
 * A restaurant's menu, as seen from the internal console.
 *
 * The restaurant owns its menu. Internal employees are here to look at it,
 * validate it during onboarding and help fix something that's wrong — not to
 * run it. So this module is read-first: listing is open to anyone with
 * RESTAURANT_MENU_VIEW, and the single write path needs the separate
 * RESTAURANT_MENU_EDIT permission and is audited item by item, because a
 * silent internal change to somebody's prices is exactly the thing a
 * restaurant would need to be able to trace afterwards.
 */

export const getMenu = async (restaurantId: number, branchId?: number) => {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, name: true },
  });
  if (!restaurant) throw notFound("Restaurant not found", "RESTAURANT_NOT_FOUND");

  const [categories, items] = await Promise.all([
    prisma.category.findMany({
      where: { restaurantId, isDeleted: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true, icon: true },
    }),
    prisma.menuItem.findMany({
      where: { restaurantId, isDeleted: false, ...(branchId ? { branchId } : {}) },
      orderBy: [{ categoryId: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        type: true,
        prepTime: true,
        isAvailable: true,
        categoryId: true,
        updatedAt: true,
        branch: { select: { id: true, name: true } },
        addOnGroups: {
          select: {
            addOnGroup: {
              select: {
                id: true,
                name: true,
                options: {
                  where: { isDeleted: false },
                  select: { id: true, name: true, price: true },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const byCategory = new Map<number | null, typeof items>();
  for (const item of items) {
    const key = item.categoryId ?? null;
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(item);
  }

  return {
    summary: {
      categories: categories.length,
      items: items.length,
      unavailable: items.filter((i) => !i.isAvailable).length,
      // Surfaced because it's the most common onboarding defect: an item that
      // exists but has no price is a menu that can't take an order.
      missingPrice: items.filter((i) => !i.price || i.price <= 0).length,
      missingCategory: items.filter((i) => !i.categoryId).length,
    },
    categories: [
      ...categories.map((category) => ({
        ...category,
        items: (byCategory.get(category.id) ?? []).map(mapItem),
      })),
      ...(byCategory.has(null)
        ? [{ id: null, name: "Uncategorised", icon: null, items: byCategory.get(null)!.map(mapItem) }]
        : []),
    ],
  };
};

const mapItem = (item: any) => ({
  id: item.id,
  name: item.name,
  description: item.description,
  price: item.price,
  type: item.type,
  prepTime: item.prepTime,
  isAvailable: item.isAvailable,
  branch: item.branch,
  updatedAt: item.updatedAt,
  addOnGroups: item.addOnGroups.map((link: any) => link.addOnGroup),
});

/**
 * The one internal write path into a restaurant's menu.
 *
 * Reuses the restaurant module's `updateMenuItemService` — it already checks
 * that the item belongs to the restaurant it's being edited under — and wraps
 * it with the audit record the restaurant would need in order to understand a
 * change it didn't make.
 */
export const updateMenuItem = async (
  req: any,
  restaurantId: number,
  itemId: number,
  input: any,
  reason: string,
) => {
  const before = await prisma.menuItem.findUnique({ where: { id: itemId } });
  if (!before || before.restaurantId !== restaurantId || before.isDeleted) {
    throw notFound("That menu item doesn't belong to this restaurant.", "MENU_ITEM_NOT_FOUND");
  }

  const updated = await updateMenuItemService(restaurantId, itemId, input);

  await prisma.internalAuditLog.create({
    data: auditData(req, {
      action: AUDIT_ACTIONS.MENU_ITEM_UPDATED,
      resourceType: "MenuItem",
      resourceId: itemId,
      resourceLabel: `${before.name} @ RES-${restaurantId}`,
      previousValue: pick(before, ["name", "price", "isAvailable", "description", "categoryId", "prepTime"]),
      newValue: pick(updated, ["name", "price", "isAvailable", "description", "categoryId", "prepTime"]),
      reason,
    }),
  });

  return updated;
};
