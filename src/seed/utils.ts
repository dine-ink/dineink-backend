import { fakerEN_IN as faker } from "@faker-js/faker";
import { addDays, addMinutes, eachDayOfInterval, setHours, setMilliseconds, setMinutes, setSeconds, subDays, subMonths } from "date-fns";
import type { Prisma, PrismaClient } from "../../generated/prisma";
import type { SeedConfig } from "./config";

export { faker, addDays, addMinutes, subDays };

/**
 * Every generator takes `db: Db` as its first argument instead of importing
 * the `prisma` singleton directly, so the orchestrator can wrap a whole
 * phase in a single `prisma.$transaction(async (tx) => ...)` and pass `tx`
 * through — or just pass the plain client when a phase doesn't need
 * transactional atomicity.
 */
export type Db = PrismaClient | Prisma.TransactionClient;

export function initFaker(seed: number): void {
  faker.seed(seed);
}

// ─── Uniqueness pools ───────────────────────────────────────────────────────
// User.phone / Customer.phone and User.email / EmailOtp.email are globally
// unique at the DB level (see prisma/schema.prisma), not scoped per
// restaurant, so every generator that mints a phone/email must draw from
// these shared pools for the whole run.

const usedPhones = new Set<string>();
const usedEmails = new Set<string>();

export function resetUniquePools(): void {
  usedPhones.clear();
  usedEmails.clear();
}

/** 10-digit Indian mobile number starting 6-9, formatted the way this app's UI expects (plain digits). */
export function uniqueIndianMobile(): string {
  let phone: string;
  do {
    phone = indianMobile();
  } while (usedPhones.has(phone));
  usedPhones.add(phone);
  return phone;
}

/**
 * Same shape as uniqueIndianMobile() but not tracked in the unique pool —
 * for Branch/Restaurant/Vendor contact numbers, none of which are
 * `@unique` in the schema, so there's nothing to dedupe against.
 */
export function indianMobile(): string {
  const prefix = faker.helpers.arrayElement(["6", "7", "8", "9"]);
  return `${prefix}${faker.string.numeric(9)}`;
}

const EMAIL_DOMAINS = ["gmail.com", "yahoo.in", "outlook.com", "rediffmail.com"];

export function uniqueEmail(nameHint: string, domains: string[] = EMAIL_DOMAINS): string {
  const base = slugify(nameHint) || "user";
  let email: string;
  let attempt = 0;
  do {
    const suffix = attempt === 0 ? "" : String(attempt);
    email = `${base}${suffix}@${faker.helpers.arrayElement(domains)}`;
    attempt++;
  } while (usedEmails.has(email));
  usedEmails.add(email);
  return email;
}

const COMBINING_DIACRITICS = /[̀-ͯ]/g;

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

// ─── Randomness helpers ─────────────────────────────────────────────────────
// Thin wrappers over faker so generator code reads naturally and every call
// site draws from the single seeded faker instance above.

export function randomInt(min: number, max: number): number {
  return faker.number.int({ min, max });
}

export function randomFloat(min: number, max: number, fractionDigits = 2): number {
  return faker.number.float({ min, max, fractionDigits });
}

/** Rounds to 2 decimals — use for any money value so seeded data never has sub-paisa noise. */
export function randomMoney(min: number, max: number): number {
  return Math.round(randomFloat(min, max, 2) * 100) / 100;
}

export function pickOne<T>(items: readonly T[]): T {
  return faker.helpers.arrayElement(items as T[]);
}

/** Samples up to `count` distinct items from `items`, without replacement, via the seeded faker instance. */
export function sampleUnique<T>(items: readonly T[], count: number): T[] {
  return faker.helpers.arrayElements(items as T[], Math.min(count, items.length));
}

/** Weighted-random choice over a `{ key: weight }` map, e.g. an orderTypeMix. */
export function weightedPick<T extends string>(weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = randomFloat(0, total, 6);
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

/** Same as weightedPick() but for a `{ numericKey: weight }` map (e.g. table capacityMix). */
export function weightedPickNumber(weights: Record<number, number>): number {
  const entries = Object.entries(weights).map(([k, w]) => [Number(k), w] as [number, number]);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = randomFloat(0, total, 6);
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

/** True with the given probability (0-1). */
export function chance(probability: number): boolean {
  return randomFloat(0, 1, 6) < probability;
}

// ─── Date helpers ───────────────────────────────────────────────────────────

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/** Every calendar day from `monthsBack` months ago through `anchor`, inclusive. */
export function historyDateRange(monthsBack: number, anchor: Date = new Date()): Date[] {
  return eachDayOfInterval({ start: subMonths(anchor, monthsBack), end: anchor });
}

/** Every calendar day from `days - 1` days ago through `anchor`, inclusive (so `days=90` gives exactly 90 dates). */
export function historyDaysRange(days: number, anchor: Date = new Date()): Date[] {
  return eachDayOfInterval({ start: subDays(anchor, days - 1), end: anchor });
}

/** Distinct (month, year) pairs touched by historyDateRange(monthsBack) — for once-per-month rows like InventoryRestock/ShopExpense. */
export function historyMonths(monthsBack: number, anchor: Date = new Date()): Array<{ month: number; year: number }> {
  const seen = new Set<string>();
  const result: Array<{ month: number; year: number }> = [];
  for (const day of historyDateRange(monthsBack, anchor)) {
    const month = day.getMonth() + 1;
    const year = day.getFullYear();
    const key = `${year}-${month}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ month, year });
  }
  return result;
}

/** Midnight UTC for the calendar day of `date` — the convention this schema uses for date-only columns (see DailyStockAudit.auditDate). */
export function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

/** `day` with a random time of day between startHour (inclusive) and endHour (exclusive). */
export function randomTimeOnDay(day: Date, startHour: number, endHour: number): Date {
  const hour = randomInt(startHour, Math.max(startHour, endHour - 1));
  const minute = randomInt(0, 59);
  const second = randomInt(0, 59);
  return setMilliseconds(setSeconds(setMinutes(setHours(day, hour), minute), second), 0);
}

// ─── Batching ───────────────────────────────────────────────────────────────

export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Runs `createFn` once per chunk of `items` (default chunk size 500 —
 * comfortably under Postgres's parameter-count ceiling for wide rows) and
 * concatenates the results. Pass a closure over `prisma.<model>.createManyAndReturn`
 * so callers get typed rows (with generated ids) back instead of a bare count.
 */
export async function batchCreateManyAndReturn<TData, TResult>(
  items: TData[],
  createFn: (chunk: TData[]) => Promise<TResult[]>,
  chunkSize = 500,
): Promise<TResult[]> {
  const results: TResult[] = [];
  for (const chunk of chunkArray(items, chunkSize)) {
    if (chunk.length === 0) continue;
    results.push(...(await createFn(chunk)));
  }
  return results;
}

// ─── Progress logging ───────────────────────────────────────────────────────

export async function runStep<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  process.stdout.write(`→ ${label} ... `);
  try {
    const result = await fn();
    console.log(`done (${Date.now() - start}ms)`);
    return result;
  } catch (err) {
    console.log("FAILED");
    throw err;
  }
}

// ─── Scoped, demo-restaurant-only reset ─────────────────────────────────────
// Every deleteMany()/updateMany() below carries a where clause that
// ultimately bottoms out at `restaurantId: { in: demoRestaurantIds }` (either
// directly, or by filtering through a defined Prisma relation to get there).
// There is deliberately no bare deleteMany() anywhere in this file — data
// belonging to any other restaurant is structurally unreachable by this code,
// not just unlikely to be touched.

/**
 * Looks up the demo restaurant(s) by config.demoRestaurantName. This is the
 * one place that decides what counts as "ours" — if a real `isDemo` column
 * is ever added to Restaurant, this is the only function that needs to
 * change (swap the `where` to `{ isDemo: true }`).
 */
export async function findDemoRestaurantIds(db: Db, config: SeedConfig): Promise<number[]> {
  if (!config.demoRestaurantName.trim()) {
    throw new Error("findDemoRestaurantIds: config.demoRestaurantName is empty — refusing to match every restaurant.");
  }
  const rows = await db.restaurant.findMany({
    where: { name: config.demoRestaurantName },
    select: { id: true, name: true },
  });
  if (rows.length > 1) {
    console.log(
      `  ! Warning: found ${rows.length} restaurants named "${config.demoRestaurantName}" (ids: ${rows
        .map((r) => r.id)
        .join(", ")}) — resetting all of them.`,
    );
  }
  return rows.map((r) => r.id);
}

/** Row counts scoped to `restaurantIds`, computed with the exact same filters resetDemoRestaurantData() deletes with — printed as a pre-delete audit trail. */
async function previewDemoDataCounts(db: Db, restaurantIds: number[]): Promise<Record<string, number>> {
  const ids = restaurantIds;
  const counts = await Promise.all([
    db.bill.count({ where: { restaurantId: { in: ids } } }),
    db.runningOrder.count({ where: { restaurantId: { in: ids } } }),
    db.menuItem.count({ where: { restaurantId: { in: ids } } }),
    db.ingredient.count({ where: { restaurantId: { in: ids } } }),
    db.vendor.count({ where: { restaurantId: { in: ids } } }),
    db.customer.count({ where: { restaurantId: { in: ids } } }),
    db.user.count({ where: { restaurantId: { in: ids } } }),
    db.branch.count({ where: { restaurantId: { in: ids } } }),
  ]);
  return {
    Bill: counts[0],
    RunningOrder: counts[1],
    MenuItem: counts[2],
    Ingredient: counts[3],
    Vendor: counts[4],
    Customer: counts[5],
    User: counts[6],
    Branch: counts[7],
  };
}

/**
 * Deletes every row belonging to the demo restaurant(s) found by
 * findDemoRestaurantIds(), in strict child-before-parent order (most
 * relations in this schema are RESTRICT, not CASCADE, so order matters),
 * then logs a preview of the scope before actually deleting anything.
 *
 * EmailOtp / PasswordResetOtp are intentionally left alone: they're
 * unrelated to restaurant data and may hold live in-flight state.
 */
export async function resetDemoRestaurantData(db: Db, config: SeedConfig): Promise<void> {
  const restaurantIds = await findDemoRestaurantIds(db, config);
  if (restaurantIds.length === 0) {
    console.log(`  No existing restaurant named "${config.demoRestaurantName}" — nothing to reset.`);
    return;
  }

  const preview = await previewDemoDataCounts(db, restaurantIds);
  console.log(
    `  About to delete demo restaurant(s) [${restaurantIds.join(", ")}] "${config.demoRestaurantName}": ` +
      Object.entries(preview)
        .filter(([, n]) => n > 0)
        .map(([model, n]) => `${model}=${n}`)
        .join(", ") || "(no rows in the high-volume tables — foundation-only data)",
  );

  const r = { in: restaurantIds };

  const deletionSteps: Array<[string, () => Promise<{ count: number }>]> = [
    [
      "RunningOrderBatchItemAddOn",
      () =>
        db.runningOrderBatchItemAddOn.deleteMany({
          where: { runningOrderBatchItem: { runningOrderBatch: { runningOrder: { restaurantId: r } } } },
        }),
    ],
    ["BillItemAddOn", () => db.billItemAddOn.deleteMany({ where: { billItem: { bill: { restaurantId: r } } } })],
    [
      "RunningOrderBatchItem",
      () => db.runningOrderBatchItem.deleteMany({ where: { runningOrderBatch: { runningOrder: { restaurantId: r } } } }),
    ],
    ["BillItem", () => db.billItem.deleteMany({ where: { bill: { restaurantId: r } } })],
    ["BillRefund", () => db.billRefund.deleteMany({ where: { bill: { restaurantId: r } } })],
    ["AttendanceBreak", () => db.attendanceBreak.deleteMany({ where: { attendance: { restaurantId: r } } })],
    ["RunningOrderBatch", () => db.runningOrderBatch.deleteMany({ where: { runningOrder: { restaurantId: r } } })],
    ["RunningOrder", () => db.runningOrder.deleteMany({ where: { restaurantId: r } })],
    ["Bill", () => db.bill.deleteMany({ where: { restaurantId: r } })],
    ["MenuItemAddOnGroup", () => db.menuItemAddOnGroup.deleteMany({ where: { menuItem: { restaurantId: r } } })],
    ["MenuItemIngredient", () => db.menuItemIngredient.deleteMany({ where: { menuItem: { restaurantId: r } } })],
    ["AddOn", () => db.addOn.deleteMany({ where: { addOnGroup: { restaurantId: r } } })],
    ["Attendance", () => db.attendance.deleteMany({ where: { restaurantId: r } })],
    ["DailyCashSession", () => db.dailyCashSession.deleteMany({ where: { restaurantId: r } })],
    ["ShopExpense", () => db.shopExpense.deleteMany({ where: { restaurantId: r } })],
    ["VendorPayment", () => db.vendorPayment.deleteMany({ where: { restaurantId: r } })],
    ["VendorInvoice", () => db.vendorInvoice.deleteMany({ where: { restaurantId: r } })],
    ["IngredientPriceHistory", () => db.ingredientPriceHistory.deleteMany({ where: { restaurantId: r } })],
    ["InventoryAdjustment", () => db.inventoryAdjustment.deleteMany({ where: { restaurantId: r } })],
    ["DailyStockAudit", () => db.dailyStockAudit.deleteMany({ where: { restaurantId: r } })],
    ["SopChecklist", () => db.sopChecklist.deleteMany({ where: { restaurantId: r } })],
    ["IngredientVendor", () => db.ingredientVendor.deleteMany({ where: { ingredient: { restaurantId: r } } })],
    ["MenuItem", () => db.menuItem.deleteMany({ where: { restaurantId: r } })],
    ["Ingredient", () => db.ingredient.deleteMany({ where: { restaurantId: r } })],
    ["Category", () => db.category.deleteMany({ where: { restaurantId: r } })],
    ["BillingSettings", () => db.billingSettings.deleteMany({ where: { branch: { restaurantId: r } } })],
    ["DiscountCode", () => db.discountCode.deleteMany({ where: { restaurantId: r } })],
    ["Vendor", () => db.vendor.deleteMany({ where: { restaurantId: r } })],
    ["IngredientCategory", () => db.ingredientCategory.deleteMany({ where: { restaurantId: r } })],
    ["Customer", () => db.customer.deleteMany({ where: { restaurantId: r } })],
    // restaurantId is a plain (non-relation) column on RestaurantTable / InvoiceSequence — filter it directly.
    ["RestaurantTable", () => db.restaurantTable.deleteMany({ where: { restaurantId: r } })],
    ["AddOnGroup", () => db.addOnGroup.deleteMany({ where: { restaurantId: r } })],
    ["RestaurantInsights", () => db.restaurantInsights.deleteMany({ where: { restaurantId: r } })],
    ["InventoryRestock", () => db.inventoryRestock.deleteMany({ where: { restaurantId: r } })],
    ["InvoiceSequence", () => db.invoiceSequence.deleteMany({ where: { restaurantId: r } })],
    ["Branch", () => db.branch.deleteMany({ where: { restaurantId: r } })],
  ];

  for (const [label, run] of deletionSteps) {
    const { count } = await run();
    if (count > 0) console.log(`    – ${label}: ${count} deleted`);
  }

  // Restaurant <-> User form a two-node FK cycle (Restaurant.ownerId,
  // User.restaurantId), both scoped to `restaurantIds` only — null the
  // owner reference out before either side can be deleted.
  await db.restaurant.updateMany({ where: { id: { in: restaurantIds } }, data: { ownerId: null } });
  const { count: usersDeleted } = await db.user.deleteMany({ where: { restaurantId: r } });
  if (usersDeleted > 0) console.log(`    – User: ${usersDeleted} deleted`);
  const { count: restaurantsDeleted } = await db.restaurant.deleteMany({ where: { id: { in: restaurantIds } } });
  console.log(`    – Restaurant: ${restaurantsDeleted} deleted`);
}
