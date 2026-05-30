import prisma from "../../config/prisma";

export const getRunningOrdersService = async (
  branchId: number,
  restaurantId?: number,
  from?: string,
  to?: string,
) => {
  const dateFilter =
    from && to
      ? {
          createdAt: {
            gte: new Date(from),
            lte: new Date(to + "T23:59:59.999Z"),
          },
        }
      : {};

  const where: any = { branchId, ...dateFilter };
  if (restaurantId) where.restaurantId = restaurantId;

  return prisma.runningOrder.findMany({
    where,
    include: {
      table: { select: { id: true, name: true, capacity: true } },
      batches: {
        include: {
          items: {
            select: {
              id: true,
              menuItemId: true,
              itemName: true,
              quantity: true,
              price: true,
              total: true,
              status: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
};
