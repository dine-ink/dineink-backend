import bcrypt from "bcryptjs";
import type { DiscountCode, Restaurant, User } from "../../../generated/prisma";
import type { SeedConfig } from "../config";
import { addDays, type Db } from "../utils";

export interface RestaurantSeedResult {
  restaurant: Restaurant;
  owner: User;
  discountCodes: DiscountCode[];
}

const BCRYPT_ROUNDS = 10;

function discountCodeExpiry(daysFromNow: number | null): Date | null {
  return daysFromNow == null ? null : addDays(new Date(), daysFromNow);
}

/** DiscountCode is a pure config mirror (no randomness) — always safe to upsert into sync. */
async function ensureDiscountCodes(db: Db, config: SeedConfig, restaurantId: number): Promise<DiscountCode[]> {
  const codes: DiscountCode[] = [];
  for (const d of config.discountCodes) {
    codes.push(
      await db.discountCode.upsert({
        where: { restaurantId_code: { restaurantId, code: d.code } },
        update: {
          type: d.type,
          value: d.value,
          maxUses: d.maxUses,
          expiresAt: discountCodeExpiry(d.expiresInDays),
          isActive: true,
        },
        create: {
          restaurantId,
          code: d.code,
          type: d.type,
          value: d.value,
          maxUses: d.maxUses,
          expiresAt: discountCodeExpiry(d.expiresInDays),
        },
      }),
    );
  }
  return codes;
}

/**
 * Owns: Restaurant, the single restaurant-wide OWNER User, and the
 * restaurant's DiscountCode promo codes (config.discountCodes).
 *
 * Idempotent: looks the restaurant up by config.demoRestaurantName first. If
 * found, reuses it — updating only its config-derived contact fields and
 * discount codes — instead of creating a duplicate. This is what makes a
 * plain `npm run seed` safe to run repeatedly without --fresh; `--fresh`
 * deletes the demo restaurant first (see resetDemoRestaurantData in
 * utils.ts) so this always takes the "create fresh" branch in that case.
 *
 * On first creation, Restaurant.ownerId and User.restaurantId form a
 * two-node FK cycle (both nullable — see prisma/schema.prisma), resolved by
 * creating the owner User with restaurantId left null, creating the
 * Restaurant with ownerId set, then patching the owner's restaurantId back.
 * The owner's branchId is intentionally left null (not tied to one branch).
 */
export async function generateRestaurant(db: Db, config: SeedConfig): Promise<RestaurantSeedResult> {
  const existing = await db.restaurant.findFirst({ where: { name: config.demoRestaurantName } });

  if (existing) {
    const restaurant = await db.restaurant.update({
      where: { id: existing.id },
      data: {
        email: config.restaurant.email,
        phone: config.restaurant.phone,
        address: config.restaurant.address,
        gstNumber: config.restaurant.gstNumber,
      },
    });

    const owner = existing.ownerId
      ? await db.user.findUnique({ where: { id: existing.ownerId } })
      : await db.user.findFirst({ where: { restaurantId: restaurant.id, role: "OWNER" } });
    if (!owner) {
      throw new Error(
        `generateRestaurant: found restaurant "${restaurant.name}" (id=${restaurant.id}) with no OWNER user — ` +
          `data is inconsistent, run "npm run seed -- --fresh" to rebuild it cleanly.`,
      );
    }

    return { restaurant, owner, discountCodes: await ensureDiscountCodes(db, config, restaurant.id) };
  }

  const hashedPassword = await bcrypt.hash(config.restaurant.ownerPassword, BCRYPT_ROUNDS);

  const owner = await db.user.create({
    data: {
      name: config.restaurant.ownerName,
      email: config.restaurant.ownerEmail,
      phone: config.restaurant.ownerPhone,
      password: hashedPassword,
      role: "OWNER",
      hasLogin: true,
      isActive: true,
    },
  });

  const restaurant = await db.restaurant.create({
    data: {
      name: config.restaurant.name,
      email: config.restaurant.email,
      phone: config.restaurant.phone,
      address: config.restaurant.address,
      gstNumber: config.restaurant.gstNumber,
      ownerId: owner.id,
    },
  });

  const linkedOwner = await db.user.update({
    where: { id: owner.id },
    data: { restaurantId: restaurant.id },
  });

  return { restaurant, owner: linkedOwner, discountCodes: await ensureDiscountCodes(db, config, restaurant.id) };
}
