// Integration test — hits the real configured database directly. Creates
// its own isolated fixture restaurants and deletes every row afterward.
//
// Verifies the CRITICAL Phase-2-audit fix: Customer.phone is scoped per
// restaurant (@@unique([restaurantId, phone])), not globally unique, so the
// same phone number at two different restaurants creates two independent
// Customer rows instead of one restaurant's checkout silently reusing (and
// cross-tenant-leaking) another restaurant's existing customer record.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "../../config/prisma";

describe("Customer.phone scoping — integration (real database)", () => {
  let restaurantAId: number;
  let restaurantBId: number;
  const sharedPhone = `9${Date.now().toString().slice(-9)}`; // unique-enough per test run, deliberately reused across both restaurants below

  beforeAll(async () => {
    const [a, b] = await Promise.all([
      prisma.restaurant.create({ data: { name: "Vitest Customer Phone Restaurant A" } }),
      prisma.restaurant.create({ data: { name: "Vitest Customer Phone Restaurant B" } }),
    ]);
    restaurantAId = a.id;
    restaurantBId = b.id;
  });

  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { restaurantId: { in: [restaurantAId, restaurantBId] } } });
    await prisma.restaurant.deleteMany({ where: { id: { in: [restaurantAId, restaurantBId] } } });
  });

  it("the exact same phone number creates two independent Customer rows at two different restaurants, using the checkout upsert's own where-clause shape", async () => {
    const upsertFor = (restaurantId: number, name: string) =>
      prisma.customer.upsert({
        where: { restaurantId_phone: { restaurantId, phone: sharedPhone } },
        update: {},
        create: { name, phone: sharedPhone, restaurant: { connect: { id: restaurantId } } },
      });

    const customerA = await upsertFor(restaurantAId, "Customer At Restaurant A");
    const customerB = await upsertFor(restaurantBId, "Customer At Restaurant B");

    expect(customerA.id).not.toBe(customerB.id);
    expect(customerA.restaurantId).toBe(restaurantAId);
    expect(customerB.restaurantId).toBe(restaurantBId);
    expect(customerA.name).toBe("Customer At Restaurant A");
    expect(customerB.name).toBe("Customer At Restaurant B");

    // Re-upserting the same phone at Restaurant A again must return the SAME row (idempotent), not create a third.
    const customerAAgain = await upsertFor(restaurantAId, "Should Not Overwrite Name");
    expect(customerAAgain.id).toBe(customerA.id);
    expect(customerAAgain.name).toBe("Customer At Restaurant A"); // update: {} — name is never overwritten

    const totalRows = await prisma.customer.count({ where: { phone: sharedPhone } });
    expect(totalRows).toBe(2);
  });
});
