import type { Ingredient, IngredientVendor, Prisma, Vendor, VendorInvoice, VendorPayment } from "../../../generated/prisma";
import type { SeedConfig } from "../config";
import type { SeedContext } from "../context";
import {
  batchCreateManyAndReturn,
  chance,
  type Db,
  historyDateRange,
  historyMonths,
  indianMobile,
  pickOne,
  randomFloat,
  randomInt,
  sampleUnique,
  slugify,
  weightedPick,
} from "../utils";

export interface VendorSeedResult {
  vendors: Vendor[];
  ingredientVendors: IngredientVendor[];
}

export interface VendorFinancialsResult {
  invoices: VendorInvoice[];
  payments: VendorPayment[];
}

// Name pools sized to exactly cover VENDOR_ALLOCATION below — real-sounding
// but deliberately generic (no references to actual dairy/gas-brand names).
const VENDOR_NAME_POOLS: Record<string, string[]> = {
  Vegetables: [
    "Koyambedu Vegetable Traders",
    "Chennai Green Farms Supply",
    "Anna Nagar Fresh Produce",
    "OMR Organic Vegetable Co.",
  ],
  Rice: ["Tamil Nadu Rice Mills", "Sona Masuri Rice Depot", "Chennai Grain Traders"],
  Milk: ["Chennai City Dairy Supply", "South India Milk Distributors", "Fresh Dairy Co. Chennai"],
  Bakery: ["Golden Crust Bakery Supplies", "Chennai Bakers Hub"],
  Cleaning: ["SparkleClean Supplies Chennai", "Pure Hygiene Distributors"],
  Packaging: ["EcoPack Chennai Pvt Ltd", "Chennai Packaging Solutions", "QuickPack Supplies"],
  Gas: ["Chennai Commercial Gas Agency", "City LPG Distributors"],
  Stationery: ["Office Mart Chennai"],
};

/** How config.counts.vendors (20) splits across config.vendorCategories — sums to 20 given the name pools above. */
const VENDOR_ALLOCATION: Record<string, number> = {
  Vegetables: 4,
  Rice: 3,
  Milk: 3,
  Packaging: 3,
  Cleaning: 2,
  Bakery: 2,
  Gas: 2,
  Stationery: 1,
};

/** Which vendor category supplies a given ingredient category — several ingredient categories share a general grocery/dairy vendor rather than needing a 1:1 vendor category. */
const INGREDIENT_TO_VENDOR_CATEGORY: Record<string, string> = {
  Vegetables: "Vegetables",
  Groceries: "Rice",
  Spices: "Rice",
  Oil: "Rice",
  Milk: "Milk",
  Cheese: "Milk",
  Paneer: "Milk",
  Packaging: "Packaging",
  "Cleaning Supplies": "Cleaning",
};

/** Vendor rows don't carry their own category back — re-derive it from which name pool their name came from. */
function categoryOfVendor(vendor: Vendor): string | undefined {
  return Object.entries(VENDOR_NAME_POOLS).find(([, names]) => names.includes(vendor.name))?.[0];
}

async function ensureVendors(db: Db, config: SeedConfig, restaurantId: number): Promise<Vendor[]> {
  const existing = await db.vendor.findMany({ where: { restaurantId } });
  if (existing.length > 0) return existing;

  const rows: Prisma.VendorCreateManyInput[] = [];
  for (const category of config.vendorCategories) {
    const names = VENDOR_NAME_POOLS[category] ?? [];
    const count = VENDOR_ALLOCATION[category] ?? 0;
    for (const name of names.slice(0, count)) {
      rows.push({
        name,
        address: `${name.split(" ")[0]} Area, Chennai, Tamil Nadu`,
        phone: indianMobile(),
        email: `${slugify(name)}@vendors.dineinkdemo.in`,
        restaurantId,
      });
    }
  }
  return db.vendor.createManyAndReturn({ data: rows });
}

/**
 * IngredientVendor is unique on (branchId, ingredientId) — one primary
 * vendor per ingredient per branch. Skips a branch entirely if it already
 * has any mappings (idempotent, "generate once" like RestaurantTable/staff).
 * Not every ingredient gets a mapping (~85%) — some ingredients are bought
 * ad hoc / from whichever vendor has stock, same as a real kitchen.
 */
async function ensureIngredientVendors(db: Db, ctx: SeedContext, vendors: Vendor[]): Promise<IngredientVendor[]> {
  const categoryNameById = new Map(ctx.ingredientCategories.map((c) => [c.id, c.name]));
  const vendorsByCategory = new Map<string, Vendor[]>();
  for (const vendor of vendors) {
    const category = categoryOfVendor(vendor);
    if (!category) continue;
    vendorsByCategory.set(category, [...(vendorsByCategory.get(category) ?? []), vendor]);
  }

  const results: IngredientVendor[] = [];
  for (const branchCtx of ctx.branches) {
    const existing = await db.ingredientVendor.findMany({ where: { branchId: branchCtx.branch.id } });
    if (existing.length > 0) {
      results.push(...existing);
      continue;
    }

    const rows: Prisma.IngredientVendorCreateManyInput[] = [];
    for (const ingredient of ctx.ingredients) {
      if (!chance(0.85)) continue;
      const ingredientCategoryName = ingredient.categoryId ? categoryNameById.get(ingredient.categoryId) : undefined;
      const vendorCategory = ingredientCategoryName ? INGREDIENT_TO_VENDOR_CATEGORY[ingredientCategoryName] : undefined;
      const candidateVendors = vendorCategory ? vendorsByCategory.get(vendorCategory) : undefined;
      if (!candidateVendors || candidateVendors.length === 0) continue;

      const vendor = pickOne(candidateVendors);
      rows.push({ branchId: branchCtx.branch.id, ingredientId: ingredient.id, vendorId: vendor.id });
    }
    if (rows.length > 0) {
      results.push(...(await db.ingredientVendor.createManyAndReturn({ data: rows })));
    }
  }
  return results;
}

/**
 * Owns: Vendor (config.counts.vendors, tagged by config.vendorCategories)
 * and IngredientVendor (mapping each branch's ingredients to a supplying
 * vendor).
 */
export async function generateVendors(
  db: Db,
  config: SeedConfig,
  restaurantId: number,
  ctx: SeedContext,
): Promise<VendorSeedResult> {
  const vendors = await ensureVendors(db, config, restaurantId);
  const ingredientVendors = await ensureIngredientVendors(db, ctx, vendors);
  return { vendors, ingredientVendors };
}

type Cadence = "WEEKLY" | "BIWEEKLY" | "MONTHLY";

const CADENCE_BY_CATEGORY: Record<string, Cadence> = {
  Vegetables: "WEEKLY",
  Milk: "WEEKLY",
  Rice: "BIWEEKLY",
  Bakery: "MONTHLY",
  Cleaning: "MONTHLY",
  Packaging: "MONTHLY",
  Gas: "MONTHLY",
  Stationery: "MONTHLY",
};

const INVOICE_AMOUNT_RANGE: Record<string, [number, number]> = {
  Vegetables: [3000, 12000],
  Milk: [2500, 9000],
  Rice: [6000, 20000],
  Bakery: [2500, 7000],
  Cleaning: [2000, 8000],
  Packaging: [4000, 15000],
  Gas: [2000, 4500],
  Stationery: [800, 2500],
};

/** Vendor categories with no matching ingredient category (Bakery/Gas/Stationery) fall back to generic line-item names instead of real Ingredient rows. */
const FALLBACK_ITEM_NAMES: Record<string, string[]> = {
  Bakery: ["Assorted Bakery Buns", "Bread Loaves", "Pizza Base Sheets", "Pastry Sheets"],
  Gas: ["LPG Cylinder Refill (19kg Commercial)"],
  Stationery: ["Order Pads", "Printer Paper", "Pens & Markers", "Billing Rolls"],
};

/** Which ingredient categories a vendor category supplies — reverse of INGREDIENT_TO_VENDOR_CATEGORY. */
function ingredientCategoriesForVendorCategory(vendorCategory: string): string[] {
  return Object.entries(INGREDIENT_TO_VENDOR_CATEGORY)
    .filter(([, vc]) => vc === vendorCategory)
    .map(([ic]) => ic);
}

function invoiceDatesForCadence(config: SeedConfig, cadence: Cadence): Date[] {
  if (cadence === "MONTHLY") {
    return historyMonths(config.history.monthsOfHistory).map(({ month, year }) => new Date(year, month - 1, randomInt(5, 20)));
  }
  const stepDays = cadence === "WEEKLY" ? 7 : 14;
  const days = historyDateRange(config.history.monthsOfHistory);
  const dates: Date[] = [];
  for (let i = 0; i < days.length; i += stepDays) dates.push(days[i]);
  return dates;
}

interface InvoiceItem {
  name: string;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
}

function buildInvoiceItems(totalAmount: number, itemNames: string[], ingredientByName: Map<string, Ingredient>): InvoiceItem[] {
  const chosen = sampleUnique(itemNames, Math.min(itemNames.length, randomInt(2, 4)));
  const weights = chosen.map(() => randomFloat(0.5, 1.5, 3));
  const weightSum = weights.reduce((a, b) => a + b, 0);

  return chosen.map((name, i) => {
    const amount = Math.round(totalAmount * (weights[i] / weightSum) * 100) / 100;
    const ingredient = ingredientByName.get(name);
    const rate = ingredient?.pricePerUnit || Math.round(amount / randomInt(5, 20));
    return { name, qty: Math.round((amount / rate) * 100) / 100, unit: ingredient?.unit || "Piece", rate, amount };
  });
}

/**
 * Owns: VendorInvoice and VendorPayment — a plausible invoice/payment
 * history per vendor across the seeded history window. Invoice cadence
 * varies by what the vendor sells (Vegetables/Milk weekly, Rice biweekly,
 * everything else monthly), and each invoice's `items` are drawn from real
 * Ingredient rows the vendor's category actually supplies (falling back to
 * generic line items for Bakery/Gas/Stationery, which have no ingredient
 * mapping). ~75% of invoices are fully paid, ~15% partially, ~10% unpaid —
 * paidAmount and status always agree, and a VendorPayment row is created for
 * whatever was actually paid.
 *
 * Idempotent: generates once per restaurant, checked via a plain count().
 */
export async function generateVendorFinancials(db: Db, config: SeedConfig, ctx: SeedContext): Promise<VendorFinancialsResult> {
  const existingCount = await db.vendorInvoice.count({ where: { restaurantId: ctx.restaurant.id } });
  if (existingCount > 0) {
    const [invoices, payments] = await Promise.all([
      db.vendorInvoice.findMany({ where: { restaurantId: ctx.restaurant.id } }),
      db.vendorPayment.findMany({ where: { restaurantId: ctx.restaurant.id } }),
    ]);
    return { invoices, payments };
  }

  const categoryNameById = new Map(ctx.ingredientCategories.map((c) => [c.id, c.name]));
  const ingredientNamesByCategory = new Map<string, string[]>();
  const ingredientByName = new Map<string, Ingredient>();
  for (const ingredient of ctx.ingredients) {
    const categoryName = ingredient.categoryId ? categoryNameById.get(ingredient.categoryId) : undefined;
    if (!categoryName) continue;
    ingredientNamesByCategory.set(categoryName, [...(ingredientNamesByCategory.get(categoryName) ?? []), ingredient.name]);
    ingredientByName.set(ingredient.name, ingredient);
  }

  const branchesByVendor = new Map<number, number[]>();
  for (const iv of ctx.ingredientVendors) {
    branchesByVendor.set(iv.vendorId, [...new Set([...(branchesByVendor.get(iv.vendorId) ?? []), iv.branchId])]);
  }
  const allBranchIds = ctx.branches.map((b) => b.branch.id);

  const invoiceRows: Prisma.VendorInvoiceCreateManyInput[] = [];
  let invoiceSequence = 0;

  for (const vendor of ctx.vendors) {
    const category = categoryOfVendor(vendor);
    if (!category) continue;

    const cadence = CADENCE_BY_CATEGORY[category] ?? "MONTHLY";
    const [amountLow, amountHigh] = INVOICE_AMOUNT_RANGE[category] ?? [2000, 8000];
    const itemNames = ingredientCategoriesForVendorCategory(category).flatMap(
      (ic) => ingredientNamesByCategory.get(ic) ?? [],
    );
    const fallbackNames = FALLBACK_ITEM_NAMES[category] ?? ["General Supplies"];
    const supplyingBranchIds = branchesByVendor.get(vendor.id) ?? allBranchIds;

    for (const branchId of supplyingBranchIds) {
      const branchCtx = ctx.branches.find((b) => b.branch.id === branchId);
      const createdById = branchCtx?.staff.find((s) => s.role === "MANAGER")?.id ?? null;

      for (const invoiceDate of invoiceDatesForCadence(config, cadence)) {
        const totalAmount = Math.round(randomFloat(amountLow, amountHigh, 2) * 100) / 100;
        const roll = randomFloat(0, 1, 3);
        const paidAmount =
          roll < 0.75 ? totalAmount : roll < 0.9 ? Math.round(totalAmount * randomFloat(0.3, 0.7) * 100) / 100 : 0;
        const status = paidAmount === totalAmount ? "PAID" : paidAmount > 0 ? "PARTIAL" : "UNPAID";

        invoiceSequence += 1;
        invoiceRows.push({
          vendorId: vendor.id,
          restaurantId: ctx.restaurant.id,
          branchId,
          invoiceNumber: `INV-${vendor.id}-${invoiceSequence}`,
          invoiceDate,
          dueDate: new Date(invoiceDate.getTime() + randomInt(15, 30) * 24 * 60 * 60 * 1000),
          totalAmount,
          paidAmount,
          status,
          items: buildInvoiceItems(totalAmount, itemNames.length > 0 ? itemNames : fallbackNames, ingredientByName) as unknown as Prisma.InputJsonValue,
          createdById,
        });
      }
    }
  }

  const invoices = await batchCreateManyAndReturn(invoiceRows, (chunk) => db.vendorInvoice.createManyAndReturn({ data: chunk }));

  const paymentRows: Prisma.VendorPaymentCreateManyInput[] = [];
  for (const invoice of invoices) {
    if (invoice.paidAmount <= 0) continue;
    const daysToDue = Math.max(
      1,
      Math.round((invoice.dueDate ? invoice.dueDate.getTime() - invoice.invoiceDate.getTime() : 20 * 86_400_000) / 86_400_000),
    );
    paymentRows.push({
      vendorId: invoice.vendorId,
      restaurantId: ctx.restaurant.id,
      branchId: invoice.branchId,
      amount: invoice.paidAmount,
      paymentMethod: weightedPick({ UPI: 0.4, BANK_TRANSFER: 0.4, CASH: 0.2 }),
      paymentDate: new Date(invoice.invoiceDate.getTime() + randomInt(1, Math.min(daysToDue, 25)) * 24 * 60 * 60 * 1000),
      createdById: invoice.createdById,
    });
  }
  const payments = await batchCreateManyAndReturn(paymentRows, (chunk) => db.vendorPayment.createManyAndReturn({ data: chunk }));

  return { invoices, payments };
}
