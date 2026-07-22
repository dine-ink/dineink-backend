import prisma from "../../config/prisma";

export const getDiscountCodesService = async (restaurantId: number) => {
  return prisma.discountCode.findMany({
    where: { restaurantId },
    orderBy: { createdAt: "desc" },
  });
};

export const createDiscountCodeService = async (restaurantId: number, data: any) => {
  const code = String(data.code || "").trim().toUpperCase();
  if (!code) throw new Error("Code is required");
  if (!["PERCENTAGE", "FIXED"].includes(data.type)) {
    throw new Error("Type must be PERCENTAGE or FIXED");
  }
  if (!(Number(data.value) > 0)) throw new Error("Value must be greater than 0");

  return prisma.discountCode.create({
    data: {
      restaurantId,
      code,
      type: data.type,
      value: Number(data.value),
      maxUses: data.maxUses ? Number(data.maxUses) : null,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
    },
  });
};

export const updateDiscountCodeService = async (
  id: number,
  restaurantId: number,
  data: any,
) => {
  const existing = await prisma.discountCode.findUnique({ where: { id } });
  if (!existing || existing.restaurantId !== restaurantId) {
    throw new Error("Discount code not found");
  }
  return prisma.discountCode.update({
    where: { id },
    data: {
      isActive: data.isActive !== undefined ? Boolean(data.isActive) : undefined,
      value: data.value !== undefined ? Number(data.value) : undefined,
      maxUses:
        data.maxUses !== undefined
          ? data.maxUses
            ? Number(data.maxUses)
            : null
          : undefined,
      expiresAt:
        data.expiresAt !== undefined
          ? data.expiresAt
            ? new Date(data.expiresAt)
            : null
          : undefined,
    },
  });
};

export const deleteDiscountCodeService = async (id: number, restaurantId: number) => {
  const existing = await prisma.discountCode.findUnique({ where: { id } });
  if (!existing || existing.restaurantId !== restaurantId) {
    throw new Error("Discount code not found");
  }
  return prisma.discountCode.delete({ where: { id } });
};

// Validates a code against a subtotal and returns the discount it would
// apply — doesn't consume a use. The use itself is only ever counted
// atomically at the moment a bill is actually created with this code (see
// bill.service.ts/runningOrder.service.ts), inside the same row-locked
// transaction as the bill write, so a code can't be over-redeemed by two
// checkouts racing each other.
export const validateDiscountCodeService = async (
  restaurantId: number,
  rawCode: string,
  subtotal: number,
) => {
  const code = String(rawCode || "").trim().toUpperCase();
  const found = await prisma.discountCode.findUnique({
    where: { restaurantId_code: { restaurantId, code } },
  });
  if (!found || !found.isActive) throw new Error("Invalid or inactive discount code");
  if (found.expiresAt && found.expiresAt < new Date()) {
    throw new Error("This discount code has expired");
  }
  if (found.maxUses !== null && found.usedCount >= found.maxUses) {
    throw new Error("This discount code has reached its usage limit");
  }

  const discountAmount =
    found.type === "FIXED" ? Math.min(found.value, subtotal) : (subtotal * found.value) / 100;

  return { code: found.code, type: found.type, value: found.value, discountAmount };
};

// Called from inside the bill-creation transaction (row-locked first, same
// pattern as the bill-refund fix earlier this session) so two checkouts
// redeeming the same code at the same moment serialize instead of both
// reading "still has uses left" and both incrementing past the cap.
export const redeemDiscountCodeInTx = async (
  tx: any,
  restaurantId: number,
  rawCode: string | undefined | null,
) => {
  if (!rawCode) return;
  const code = String(rawCode).trim().toUpperCase();
  await tx.$executeRaw`SELECT id FROM "DiscountCode" WHERE "restaurantId" = ${restaurantId} AND "code" = ${code} FOR UPDATE`;
  const found = await tx.discountCode.findUnique({
    where: { restaurantId_code: { restaurantId, code } },
  });
  if (found && found.isActive && (found.maxUses === null || found.usedCount < found.maxUses)) {
    await tx.discountCode.update({
      where: { id: found.id },
      data: { usedCount: { increment: 1 } },
    });
  }
};
