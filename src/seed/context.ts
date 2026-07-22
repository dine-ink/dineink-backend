// Shared, incrementally-filled bundle of "what we already created" that later
// generators read from. Built up by src/seed/index.ts as each generator
// phase completes — no generator reaches back into the database to
// rediscover data another generator already produced in this run.

import type {
  AddOn,
  AddOnGroup,
  Branch,
  BillingSettings,
  Category,
  Customer,
  DiscountCode,
  Ingredient,
  IngredientCategory,
  IngredientVendor,
  InvoiceSequence,
  MenuItem,
  MenuItemAddOnGroup,
  MenuItemIngredient,
  Restaurant,
  RestaurantInsights,
  RestaurantTable,
  User,
  Vendor,
} from "../../generated/prisma";

export interface BranchContext {
  branch: Branch;
  billingSettings: BillingSettings;
  insights: RestaurantInsights;
  tables: RestaurantTable[];
  /** Staff working this branch — does not include the restaurant OWNER. */
  staff: User[];
}

export interface SeedContext {
  restaurant: Restaurant;
  owner: User;
  discountCodes: DiscountCode[];
  branches: BranchContext[];
  categories: Category[];
  ingredientCategories: IngredientCategory[];
  ingredients: Ingredient[];
  vendors: Vendor[];
  ingredientVendors: IngredientVendor[];
  menuItems: MenuItem[];
  addOnGroups: AddOnGroup[];
  addOns: AddOn[];
  menuItemAddOnGroups: MenuItemAddOnGroup[];
  /** Populated once recipe.generator.ts runs; empty before Phase 4's recipe step. */
  menuItemIngredients: MenuItemIngredient[];
  customers: Customer[];
  /** Ids of the ~20% of customers.generator.ts tags as repeat visitors — bill.generator.ts (Phase 7) biases multiple bills toward these. Not a schema field, just in-run bookkeeping. */
  frequentCustomerIds: number[];
  /** Keyed by `${branchId}:${financialYear}`. */
  invoiceSequences: Map<string, InvoiceSequence>;
}

export function findBranchContext(ctx: SeedContext, branchId: number): BranchContext {
  const found = ctx.branches.find((b) => b.branch.id === branchId);
  if (!found) {
    throw new Error(`findBranchContext: no seed context for branchId=${branchId}`);
  }
  return found;
}

export function invoiceSequenceKey(branchId: number, financialYear: string): string {
  return `${branchId}:${financialYear}`;
}
