import prisma from "../../config/prisma";

export const getCustomersByBranchService = async (
  restaurantId: number,
  branchId?: number | null,
  page = 1,
  limit = 100,
) => {
  const customers = await prisma.customer.findMany({
    where: {
      restaurantId,
      ...(branchId && { bills: { some: { branchId } } }),
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      address: true,
      createdAt: true,
      bills: {
        where: { ...(branchId && { branchId }) },
        select: {
          id: true,
          total: true,
          orderType: true,
          paymentMethod: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: (page - 1) * limit,
  });

  return customers.map(({ bills, ...customer }) => ({
    ...customer,
    visits: bills.length,
    spend: bills.reduce((sum, bill) => sum + bill.total, 0),
    lastVisit: bills[0]?.createdAt ?? null,
    preferredOrderType: bills[0]?.orderType ?? null,
    preferredPayment: bills[0]?.paymentMethod ?? null,
    bills,
  }));
};

// Point lookup for checkout — a phone number typed at the register should
// surface "returning customer, N visits" immediately, without fetching the
// whole customer list just to find one match.
export const lookupCustomerByPhoneService = async (restaurantId: number, phone: string) => {
  const customer = await prisma.customer.findFirst({
    where: { restaurantId, phone },
    select: {
      id: true,
      name: true,
      phone: true,
      bills: {
        select: { total: true, orderType: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!customer) return null;

  const { bills, ...rest } = customer;
  return {
    ...rest,
    visits: bills.length,
    spend: bills.reduce((sum, bill) => sum + bill.total, 0),
    lastVisit: bills[0]?.createdAt ?? null,
    preferredOrderType: bills[0]?.orderType ?? null,
  };
};

export const getCustomersByRestaurantService = async (
  restaurantId: number,
  page = 1,
  limit = 100,
) => {
  const customers = await prisma.customer.findMany({
    where: { restaurantId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      address: true,
      createdAt: true,
      bills: {
        select: {
          id: true,
          total: true,
          orderType: true,
          paymentMethod: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: (page - 1) * limit,
  });

  return customers.map(({ bills, ...customer }) => ({
    ...customer,
    visits: bills.length,
    spend: bills.reduce((sum, bill) => sum + bill.total, 0),
    lastVisit: bills[0]?.createdAt ?? null,
    preferredOrderType: bills[0]?.orderType ?? null,
    preferredPayment: bills[0]?.paymentMethod ?? null,
    bills,
  }));
};
