// Single source of truth for the seed generator. Change values here to get a
// differently-shaped dataset — nothing downstream should hardcode counts,
// names, or ratios that belong here.

export interface BranchSeedConfig {
  name: string;
  city: string;
  state: string;
  pincode: string;
  areaSqFt: number;
  openingTime: string; // "HH:mm"
  closingTime: string; // "HH:mm"
}

export interface UsersPerBranchConfig {
  MANAGER: number;
  CASHIER: number;
  CHEF: number;
  WAITER: number;
  CLEANING: number;
}

export interface OrderTypeMix {
  DINE_IN: number;
  TAKEAWAY: number;
  DELIVERY: number;
}

export interface PaymentMethodMix {
  UPI: number;
  CASH: number;
  CARD: number;
}

export interface DiscountCodeSeed {
  code: string;
  type: "PERCENTAGE" | "FIXED";
  value: number;
  maxUses: number | null;
  expiresInDays: number | null;
}

export interface AttendanceStatusMix {
  PRESENT: number;
  LEAVE: number;
  HALF_DAY: number;
  ABSENT: number;
}

// The one thing that identifies "our" data in an otherwise shared database.
// resetDemoData() (src/seed/utils.ts) looks restaurants up by this name and
// scopes every delete to what it finds — it never runs a bare deleteMany().
// If a real `isDemo` boolean column is ever added to Restaurant, swap the
// lookup in findDemoRestaurantIds() to use that instead; nothing else here
// needs to change.
const DEMO_RESTAURANT_NAME = "DineInk Demo Restaurant";

export const CONFIG = {
  // Bump to reseed with a different (but still reproducible) dataset.
  randomSeed: 20260722,

  demoRestaurantName: DEMO_RESTAURANT_NAME,

  restaurant: {
    name: DEMO_RESTAURANT_NAME,
    email: "contact@dineinkdemo.in",
    phone: "+91 44 4612 3456",
    address: "142 Anna Salai, Chennai, Tamil Nadu",
    gstNumber: "33AADCD1234F1Z6",
    // The OWNER account — defaults to your own login so the seeded demo is
    // immediately usable. Change freely; nothing else derives from this.
    ownerName: "Vikranth",
    ownerEmail: "vikranth005@gmail.com",
    ownerPhone: "9840012345",
    ownerPassword: "Owner@12345",
  },

  // Shared login password for every seeded staff User (hashed before
  // insert, never stored in plaintext) — printed once at the end of the
  // seed run so it's easy to log in and explore the demo data.
  staffPassword: "Staff@12345",

  // One entry per branch created for the demo restaurant. Order matters for
  // nothing else — branch.generator.ts just iterates this array.
  branches: [
    {
      name: "Anna Nagar",
      city: "Chennai",
      state: "Tamil Nadu",
      pincode: "600040",
      areaSqFt: 1400,
      openingTime: "10:00",
      closingTime: "23:00",
    },
    {
      name: "Velachery",
      city: "Chennai",
      state: "Tamil Nadu",
      pincode: "600042",
      areaSqFt: 1800,
      openingTime: "10:00",
      closingTime: "23:30",
    },
    {
      name: "OMR",
      city: "Chennai",
      state: "Tamil Nadu",
      pincode: "600097",
      areaSqFt: 2200,
      openingTime: "11:00",
      closingTime: "23:30",
    },
  ] satisfies BranchSeedConfig[],

  tables: {
    perBranch: 20,
    // capacity -> relative frequency.
    capacityMix: { 2: 0.35, 4: 0.4, 6: 0.15, 8: 0.1 } as Record<number, number>,
  },

  // Staff created per branch, on top of the single restaurant-wide OWNER
  // created by restaurant.generator.ts.
  usersPerBranch: {
    MANAGER: 1,
    CASHIER: 2,
    CHEF: 5,
    WAITER: 4,
    CLEANING: 2,
  } satisfies UsersPerBranchConfig,

  counts: {
    customers: 1500,
    // Fraction of customers who show up as a repeat visitor across multiple
    // bills rather than a single one-off visit.
    frequentCustomerRatio: 0.2,
    menuItems: 120,
    ingredients: 200,
    vendors: 20,
  },

  history: {
    monthsOfHistory: 12,
    // Bills/day/branch. NOTE: calibrated (not the illustrative 90/180 some
    // specs use) so 3 branches x ~13 weeks lands near the ~15,000-bill
    // target overall — see estimateTotalBills() below. Raise/lower freely;
    // just re-check the estimate if you do.
    weekdayBillsPerBranchPerDay: 45,
    weekendBillsPerBranchPerDay: 90,
  },

  billing: {
    orderTypeMix: { DINE_IN: 0.45, TAKEAWAY: 0.35, DELIVERY: 0.2 } satisfies OrderTypeMix,
    paymentMethodMix: { UPI: 0.5, CASH: 0.3, CARD: 0.2 } satisfies PaymentMethodMix,
    averageBillAmount: 600,
    billAmountStdDev: 180,
    itemsPerBillRange: [2, 5] as [number, number],
    // Of all bills, the fraction that carry some kind of discount, and how
    // that discounted subset splits across discount mechanisms.
    discountProbability: 0.3,
    discountKindMix: { PERCENTAGE: 0.5, FIXED: 0.2, COUPON: 0.3 },
    tipProbability: 0.35,
    tipPctOfTotalRange: [0.05, 0.1] as [number, number],
    refundProbability: 0.015,
    gstPercentage: 5,
    serviceChargePercentage: 0,
    discountApprovalThreshold: 20,
  },

  // Restaurant-wide promo codes DiscountCode rows are seeded from. bill
  // generator picks one of these whenever discountKindMix rolls "COUPON".
  discountCodes: [
    { code: "WELCOME10", type: "PERCENTAGE", value: 10, maxUses: 500, expiresInDays: null },
    { code: "FLAT100", type: "FIXED", value: 100, maxUses: 300, expiresInDays: null },
    { code: "FEST20", type: "PERCENTAGE", value: 20, maxUses: 150, expiresInDays: 45 },
  ] satisfies DiscountCodeSeed[],

  attendance: {
    daysOfHistory: 90,
    statusMix: { PRESENT: 0.92, LEAVE: 0.05, HALF_DAY: 0.02, ABSENT: 0.01 } satisfies AttendanceStatusMix,
    overtimeProbability: 0.15,
    breakProbability: 0.8,
  },

  analytics: {
    targetFoodCostPct: 0.3,
    targetPrimeCostPct: 0.55,
    targetEbitdaPct: 0.15,
    monthlyRevenueGrowthPct: 0.05,
  },

  invoicing: {
    financialYearStartMonth: 4, // April — Indian FY runs Apr 1 - Mar 31
  },

  menuCategories: [
    "Starters",
    "Soups",
    "South Indian",
    "North Indian",
    "Chinese",
    "Rice",
    "Noodles",
    "Pizza",
    "Burger",
    "Pasta",
    "Sandwich",
    "Beverages",
    "Desserts",
    "Ice Cream",
  ],

  ingredientCategories: [
    "Vegetables",
    "Groceries",
    "Spices",
    "Oil",
    "Milk",
    "Cheese",
    "Paneer",
    "Packaging",
    "Cleaning Supplies",
  ],

  vendorCategories: ["Vegetables", "Milk", "Rice", "Bakery", "Cleaning", "Packaging", "Gas", "Stationery"],
} as const;

export type SeedConfig = typeof CONFIG;

/** Rough sanity check for history.* — logged at seed startup, not enforced. */
export function estimateTotalBills(config: SeedConfig = CONFIG): number {
  const totalDays = config.history.monthsOfHistory * 30;
  const weekendDays = Math.round((totalDays / 7) * 2);
  const weekdayDays = totalDays - weekendDays;
  const perBranch =
    weekdayDays * config.history.weekdayBillsPerBranchPerDay +
    weekendDays * config.history.weekendBillsPerBranchPerDay;
  return perBranch * config.branches.length;
}
