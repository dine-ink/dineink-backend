import prisma from "../../config/prisma";

export const getSopChecklists = async (restaurantId: number, branchId?: number) => {
  return prisma.sopChecklist.findMany({
    where: {
      restaurantId,
      isActive: true,
      ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
    },
    include: {
      menuItem: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
};

export const createSopChecklist = async (data: {
  restaurantId: number;
  branchId?: number;
  menuItemId?: number;
  title: string;
  category?: string;
  steps: string[];
}) => {
  return prisma.sopChecklist.create({
    data: {
      restaurantId: data.restaurantId,
      branchId: data.branchId,
      menuItemId: data.menuItemId,
      title: data.title,
      category: data.category,
      steps: data.steps,
    },
  });
};

export const updateSopChecklist = async (
  id: number,
  data: {
    title?: string;
    category?: string;
    steps?: string[];
    menuItemId?: number | null;
    isActive?: boolean;
  },
  callerRestaurantId: number,
) => {
  const existing = await prisma.sopChecklist.findUnique({ where: { id } });
  if (!existing || existing.restaurantId !== callerRestaurantId) {
    throw new Error("SOP checklist not found");
  }
  return prisma.sopChecklist.update({
    where: { id },
    data,
  });
};

export const deleteSopChecklist = async (id: number, callerRestaurantId: number) => {
  const existing = await prisma.sopChecklist.findUnique({ where: { id } });
  if (!existing || existing.restaurantId !== callerRestaurantId) {
    throw new Error("SOP checklist not found");
  }
  return prisma.sopChecklist.update({
    where: { id },
    data: { isActive: false },
  });
};
