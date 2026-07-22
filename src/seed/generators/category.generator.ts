import type { Category } from "../../../generated/prisma";
import type { SeedConfig } from "../config";
import type { Db } from "../utils";

/**
 * Owns: Category — the menu categories in config.menuCategories, one set
 * shared restaurant-wide.
 *
 * Idempotent: no schema-level unique constraint on (restaurantId, name), so
 * this does a manual find-or-create per name rather than relying on
 * upsert()'s where clause.
 */
export async function generateCategories(db: Db, config: SeedConfig, restaurantId: number): Promise<Category[]> {
  const existing = await db.category.findMany({ where: { restaurantId, name: { in: [...config.menuCategories] } } });
  const existingNames = new Set(existing.map((c) => c.name));
  const missing = config.menuCategories.filter((name) => !existingNames.has(name));

  if (missing.length === 0) return existing;

  const created = await db.category.createManyAndReturn({
    data: missing.map((name) => ({ name, restaurantId })),
  });

  return [...existing, ...created];
}
