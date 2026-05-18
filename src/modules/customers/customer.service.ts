import prisma from "../../config/prisma";

export const getCustomersByBranchService = async (
  restaurantId: number,
  branchId?: number | null,
) => {
  const customers = await prisma.customer.findMany({
    where: {
      restaurantId,
      ...(branchId && {
        bills: {
          some: {
            branchId,
          },
        },
      }),
    },
    include: {
      bills: {
        where: {
          ...(branchId && {
            branchId,
          }),
        },
        orderBy: {
          createdAt: "desc",
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
  return customers.map((customer) => {
    const visits = customer.bills.length;
    const spend = customer.bills.reduce((sum, bill) => sum + bill.total, 0);
    const lastVisit = customer.bills[0]?.createdAt;
    return {
      ...customer,
      visits,
      spend,
      lastVisit,
    };
  });
};
export const getCustomersByRestaurantService = async (restaurantId: number) => {
  const customers = await prisma.customer.findMany({
    where: {
      restaurantId,
    },

    include: {
      bills: {
        orderBy: {
          createdAt: "desc",
        },
      },
    },

    orderBy: {
      createdAt: "desc",
    },
  });

  return customers.map((customer) => {
    const visits = customer.bills.length;

    const spend = customer.bills.reduce((sum, bill) => sum + bill.total, 0);

    const lastVisit = customer.bills[0]?.createdAt;

    return {
      ...customer,

      visits,

      spend,

      lastVisit,
    };
  });
};
