import type { BillingSettings, Branch, RestaurantInsights, RestaurantTable } from "../../../generated/prisma";
import type { BranchSeedConfig, SeedConfig } from "../config";
import { type Db, indianMobile, randomFloat, randomInt, slugify, weightedPickNumber } from "../utils";

export interface BranchSeedResult {
  branch: Branch;
  billingSettings: BillingSettings;
  insights: RestaurantInsights;
  tables: RestaurantTable[];
}

/** Rough monthly revenue this branch's history-generation config implies, used only to size RestaurantInsights targets realistically. */
function estimateMonthlyRevenue(config: SeedConfig): number {
  const billsPerWeek =
    config.history.weekdayBillsPerBranchPerDay * 5 + config.history.weekendBillsPerBranchPerDay * 2;
  const billsPerMonth = (billsPerWeek / 7) * 30;
  return billsPerMonth * config.billing.averageBillAmount;
}

async function ensureBranch(db: Db, restaurantId: number, branchConfig: BranchSeedConfig): Promise<Branch> {
  const existing = await db.branch.findFirst({ where: { restaurantId, name: branchConfig.name } });
  if (existing) {
    // Only sync the fields that come straight from config — address/phone/
    // email were randomly generated once and shouldn't drift on every run.
    return db.branch.update({
      where: { id: existing.id },
      data: {
        city: branchConfig.city,
        state: branchConfig.state,
        pincode: branchConfig.pincode,
        openingTime: branchConfig.openingTime,
        closingTime: branchConfig.closingTime,
        areaSqFt: branchConfig.areaSqFt,
      },
    });
  }
  return db.branch.create({
    data: {
      name: branchConfig.name,
      address: `${randomInt(1, 200)}, ${branchConfig.name} Main Road`,
      city: branchConfig.city,
      state: branchConfig.state,
      pincode: branchConfig.pincode,
      phone: indianMobile(),
      email: `${slugify(branchConfig.name)}@dineinkdemo.in`,
      restaurantId,
      openingTime: branchConfig.openingTime,
      closingTime: branchConfig.closingTime,
      areaSqFt: branchConfig.areaSqFt,
    },
  });
}

/** BillingSettings is a pure config mirror (no randomness) — always safe to upsert into sync. */
async function ensureBillingSettings(db: Db, config: SeedConfig, branchId: number): Promise<BillingSettings> {
  const data = {
    billingTypes: Object.keys(config.billing.orderTypeMix),
    gstPercentage: config.billing.gstPercentage,
    serviceCharge: config.billing.serviceChargePercentage,
    includeGST: true,
    enableDiscount: true,
    enableTips: true,
    paymentMethods: Object.keys(config.billing.paymentMethodMix),
    discountApprovalThreshold: config.billing.discountApprovalThreshold,
  };
  return db.billingSettings.upsert({
    where: { branchId },
    update: data,
    create: { branchId, ...data },
  });
}

/**
 * RestaurantInsights is heavily randomized (rent/utility/target estimates) —
 * generate once and leave it alone on subsequent plain runs so the numbers
 * don't jitter every time `npm run seed` is re-run. Use --fresh to reroll.
 */
async function ensureInsights(
  db: Db,
  config: SeedConfig,
  restaurantId: number,
  branchId: number,
  branchConfig: BranchSeedConfig,
): Promise<RestaurantInsights> {
  const existing = await db.restaurantInsights.findUnique({
    where: { restaurantId_branchId: { restaurantId, branchId } },
  });
  if (existing) return existing;

  const monthlyRevenue = estimateMonthlyRevenue(config);
  const monthlyRevenueGoal = Math.round(monthlyRevenue * 1.1);

  return db.restaurantInsights.create({
    data: {
      restaurantId,
      branchId,

      // Fixed expenses — rent scaled off floor area, the rest flat Chennai-plausible estimates.
      monthlyRent: Math.round(branchConfig.areaSqFt * randomFloat(60, 90)),
      loanEmi: 0,
      internet: randomInt(2000, 3000),
      phoneBills: randomInt(1500, 2500),
      accounting: randomInt(5000, 8000),
      insurance: randomInt(3000, 6000),
      licenses: randomInt(2000, 4000),

      // Variable expenses.
      deliveryCharges: Math.round(monthlyRevenue * randomFloat(0.02, 0.03)),
      packaging: Math.round(monthlyRevenue * randomFloat(0.015, 0.025)),
      paymentGateway: Math.round(monthlyRevenue * randomFloat(0.01, 0.015)),
      aggregatorCommission: Math.round(monthlyRevenue * randomFloat(0.04, 0.06)),
      electricity: randomInt(15000, 25000),
      gas: randomInt(8000, 15000),
      maintenance: randomInt(5000, 10000),
      fuel: randomInt(3000, 6000),
      marketingSpend: Math.round(monthlyRevenue * randomFloat(0.02, 0.04)),

      // Financial targets — as percentages, matching gstPercentage's convention (5 == 5%).
      targetEbitda: config.analytics.targetEbitdaPct * 100,
      targetFoodCost: config.analytics.targetFoodCostPct * 100,
      targetGrossMargin: (1 - config.analytics.targetFoodCostPct) * 100,
      targetPrimeCost: config.analytics.targetPrimeCostPct * 100,
      monthlyRevenueGoal,
      monthlyProfitGoal: Math.round(monthlyRevenueGoal * config.analytics.targetEbitdaPct),

      // Tax & finance.
      gstPercentage: config.billing.gstPercentage,
      monthlyLoanEmi: 0,
      monthlyInterestPayments: 0,
      caFees: randomInt(4000, 8000),
      insuranceCost: randomInt(2000, 4000),
      otherTaxes: randomInt(1000, 3000),

      // Business assumptions.
      expectedMonthlyGrowth: config.analytics.monthlyRevenueGrowthPct * 100,
      expectedDeliveryGrowth: randomFloat(5, 10),
      expectedInflation: randomFloat(5, 7),
      seasonalImpact: randomFloat(8, 15),
      weekendSalesIncrease: Math.round(
        ((config.history.weekendBillsPerBranchPerDay - config.history.weekdayBillsPerBranchPerDay) /
          config.history.weekdayBillsPerBranchPerDay) *
          100,
      ),
      plannedExpansion: null,

      // Left at 0 so the real recipe/restock-based food-cost calc (Phase 4/6)
      // drives EBITDA instead of a manual override — see the schema comment
      // on RestaurantInsights.manualFoodCost.
      manualFoodCost: 0,

      initialInvestment: Math.round(branchConfig.areaSqFt * randomFloat(1200, 1800)),
    },
  });
}

/** RestaurantTable has no natural unique key — generate the configured count once per branch, then leave it alone. */
async function ensureTables(
  db: Db,
  config: SeedConfig,
  restaurantId: number,
  branchId: number,
): Promise<RestaurantTable[]> {
  const existing = await db.restaurantTable.findMany({ where: { branchId } });
  if (existing.length > 0) return existing;

  const tableData = Array.from({ length: config.tables.perBranch }, (_, i) => ({
    name: `T${i + 1}`,
    capacity: weightedPickNumber(config.tables.capacityMix),
    status: "AVAILABLE",
    restaurantId,
    branchId,
  }));
  return db.restaurantTable.createManyAndReturn({ data: tableData });
}

/**
 * Owns: Branch, BillingSettings (1:1 per branch), RestaurantInsights (1:1
 * per restaurant+branch), and RestaurantTable. Called once per entry in
 * config.branches, after restaurant.generator.ts has produced a Restaurant.
 *
 * Idempotent per-model: Branch and BillingSettings sync their config-derived
 * fields on every run; RestaurantInsights and RestaurantTable are generated
 * once (they're randomized) and left untouched on subsequent plain runs —
 * use --fresh to reroll them.
 */
export async function generateBranch(
  db: Db,
  config: SeedConfig,
  restaurantId: number,
  branchConfig: BranchSeedConfig,
): Promise<BranchSeedResult> {
  const branch = await ensureBranch(db, restaurantId, branchConfig);
  const billingSettings = await ensureBillingSettings(db, config, branch.id);
  const insights = await ensureInsights(db, config, restaurantId, branch.id, branchConfig);
  const tables = await ensureTables(db, config, restaurantId, branch.id);

  return { branch, billingSettings, insights, tables };
}
