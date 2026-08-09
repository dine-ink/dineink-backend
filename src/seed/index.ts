import prisma from "../config/prisma";
import { CONFIG, estimateTotalBills } from "./config";
import type { BranchContext, SeedContext } from "./context";
import { validateAnalytics } from "./generators/analytics.generator";
import { generateAttendance } from "./generators/attendance.generator";
import { generateBankingData } from "./generators/banking.generator";
import { generateBillingHistory } from "./generators/bill.generator";
import { generateBranch } from "./generators/branch.generator";
import { generateCategories } from "./generators/category.generator";
import { generateComplianceRecords } from "./generators/compliance.generator";
import { generateCustomers } from "./generators/customer.generator";
import { generateMonthlyDues } from "./generators/dues.generator";
import { generateEmiSchedules } from "./generators/emi.generator";
import { generateEquipment } from "./generators/equipment.generator";
import { generateBranchOperations } from "./generators/expense.generator";
import { generateIngredients } from "./generators/ingredient.generator";
import { generateDailyStockAudits, generateInventoryActivity } from "./generators/inventory.generator";
import { generateMenu } from "./generators/menu.generator";
import { generatePayrollData } from "./generators/payroll.generator";
import { generateRecipes } from "./generators/recipe.generator";
import { generateRestaurant } from "./generators/restaurant.generator";
import { generateBranchStaff } from "./generators/user.generator";
import { generateVendorFinancials, generateVendors } from "./generators/vendor.generator";
import { generateWhatsAppMessageLogs } from "./generators/whatsapp.generator";
import { initFaker, resetDemoRestaurantData, resetUniquePools, runStep } from "./utils";

export interface RunSeedOptions {
  /** --fresh: delete the demo restaurant's existing data (scoped, never a bare deleteMany()) before recreating it. */
  fresh?: boolean;
}

interface SeedPlanStep {
  phase: number;
  label: string;
  done: boolean;
}

// The full pipeline, in dependency order. `done` flips to true as each
// phase's generator calls land in runSeed() below — this list is the single
// place that shows how much of the seed is actually wired up.
const SEED_PLAN: SeedPlanStep[] = [
  { phase: 2, label: "Restaurant + Owner + Discount Codes", done: true },
  { phase: 2, label: "Branches + Billing Settings + Insights + Tables", done: true },
  { phase: 2, label: "Branch Staff (Users)", done: true },
  { phase: 3, label: "Menu Categories", done: true },
  { phase: 3, label: "Ingredient Categories + Ingredients + Price History", done: true },
  { phase: 3, label: "Vendors + Ingredient-Vendor Mapping", done: true },
  { phase: 4, label: "Menu Items + Add-On Groups", done: true },
  { phase: 4, label: "Recipes (Menu Item Ingredients)", done: true },
  { phase: 5, label: "Customers", done: true },
  { phase: 5, label: "Attendance (90 days)", done: true },
  { phase: 6, label: "Inventory Restocks + Adjustments", done: true },
  { phase: 6, label: "Daily Cash Sessions + Shop Expenses", done: true },
  { phase: 6, label: "Vendor Invoices + Payments", done: true },
  { phase: 7, label: "Bills, Orders & Running Orders (~15,000 bills)", done: true },
  { phase: 7, label: "Daily Stock Audit (needs Bill/BillItem data to exist)", done: true },
  { phase: 8, label: "Analytics Validation Report", done: true },
  { phase: 9, label: "EMI Schedules + Equipment", done: true },
  { phase: 9, label: "Compliance Records + Monthly Dues", done: true },
  { phase: 9, label: "WhatsApp Message Logs", done: true },
  { phase: 9, label: "Leave Requests + Salary Deductions + Payroll Runs", done: true },
  { phase: 9, label: "Bank Accounts + UPI Configs + Bank Transaction Entries", done: true },
];

async function runFoundationPhase(): Promise<SeedContext> {
  return prisma.$transaction(
    async (tx) => {
      const { restaurant, owner, discountCodes } = await generateRestaurant(tx, CONFIG);

      const branches: BranchContext[] = [];
      for (const branchConfig of CONFIG.branches) {
        const { branch, billingSettings, insights, tables } = await generateBranch(
          tx,
          CONFIG,
          restaurant.id,
          branchConfig,
        );
        const staff = await generateBranchStaff(tx, CONFIG, restaurant.id, branch.id);
        branches.push({ branch, billingSettings, insights, tables, staff });
      }

      const ctx: SeedContext = {
        restaurant,
        owner,
        discountCodes,
        branches,
        categories: [],
        ingredientCategories: [],
        ingredients: [],
        vendors: [],
        ingredientVendors: [],
        menuItems: [],
        addOnGroups: [],
        addOns: [],
        menuItemAddOnGroups: [],
        menuItemIngredients: [],
        customers: [],
        frequentCustomerIds: [],
        invoiceSequences: new Map(),
      };
      return ctx;
    },
    { timeout: 90_000 },
  );
}

async function runCatalogPhase(ctx: SeedContext): Promise<{ ctx: SeedContext; priceHistoryCount: number }> {
  return prisma.$transaction(
    async (tx) => {
      const categories = await generateCategories(tx, CONFIG, ctx.restaurant.id);
      const { categories: ingredientCategories, ingredients, priceHistory } = await generateIngredients(
        tx,
        CONFIG,
        ctx.restaurant.id,
      );

      const withIngredients: SeedContext = { ...ctx, categories, ingredientCategories, ingredients };
      const { vendors, ingredientVendors } = await generateVendors(tx, CONFIG, ctx.restaurant.id, withIngredients);

      return { ctx: { ...withIngredients, vendors, ingredientVendors }, priceHistoryCount: priceHistory.length };
    },
    { timeout: 150_000 },
  );
}

function logCatalogSummary(ctx: SeedContext, priceHistoryCount: number): void {
  const ingredientsByCategory = new Map<string, number>();
  const categoryNameById = new Map(ctx.ingredientCategories.map((c) => [c.id, c.name]));
  for (const ingredient of ctx.ingredients) {
    const name = (ingredient.categoryId && categoryNameById.get(ingredient.categoryId)) || "Uncategorized";
    ingredientsByCategory.set(name, (ingredientsByCategory.get(name) ?? 0) + 1);
  }

  console.log(`  - Menu categories: ${ctx.categories.length} (${ctx.categories.map((c) => c.name).join(", ")})`);
  console.log(`  - Ingredients: ${ctx.ingredients.length} across ${ctx.ingredientCategories.length} categories`);
  for (const [name, count] of ingredientsByCategory) {
    console.log(`      ${name}: ${count}`);
  }
  console.log(`  - Ingredient price history rows: ${priceHistoryCount}`);
  console.log(`  - Vendors: ${ctx.vendors.length}`);
  console.log(`  - Ingredient-Vendor mappings: ${ctx.ingredientVendors.length}`);
}

async function runMenuPhase(ctx: SeedContext): Promise<SeedContext> {
  return prisma.$transaction(
    async (tx) => {
      const { menuItems, addOnGroups, addOns, menuItemAddOnGroups } = await generateMenu(tx, CONFIG, ctx);
      const withMenu: SeedContext = { ...ctx, menuItems, addOnGroups, addOns, menuItemAddOnGroups };

      const menuItemIngredients = await generateRecipes(tx, CONFIG, withMenu);
      return { ...withMenu, menuItemIngredients };
    },
    { timeout: 150_000 },
  );
}

function logMenuSummary(ctx: SeedContext): void {
  const itemsByCategory = new Map<string, number>();
  const categoryNameById = new Map(ctx.categories.map((c) => [c.id, c.name]));
  for (const item of ctx.menuItems) {
    const name = (item.categoryId && categoryNameById.get(item.categoryId)) || "Uncategorized";
    itemsByCategory.set(name, (itemsByCategory.get(name) ?? 0) + 1);
  }

  console.log(`  - Menu items: ${ctx.menuItems.length}`);
  for (const [name, count] of itemsByCategory) {
    console.log(`      ${name}: ${count}`);
  }
  console.log(`  - Add-on groups: ${ctx.addOnGroups.map((g) => g.name).join(", ")} (${ctx.addOns.length} options total)`);
  console.log(`  - Menu item <-> add-on group links: ${ctx.menuItemAddOnGroups.length}`);
  console.log(`  - Recipe rows (MenuItemIngredient): ${ctx.menuItemIngredients.length}`);

  const recipesByItem = new Map<number, number>();
  for (const r of ctx.menuItemIngredients) {
    recipesByItem.set(r.menuItemId, (recipesByItem.get(r.menuItemId) ?? 0) + 1);
  }
  const itemsWithoutRecipe = ctx.menuItems.filter((m) => !recipesByItem.has(m.id)).length;
  if (itemsWithoutRecipe > 0) {
    console.log(`  ! ${itemsWithoutRecipe} menu item(s) have no recipe mapped (category not in MENU_TO_INGREDIENT_CATEGORIES)`);
  }
}

async function runPeoplePhase(
  ctx: SeedContext,
): Promise<{ ctx: SeedContext; attendanceCount: number; breakCount: number }> {
  return prisma.$transaction(
    async (tx) => {
      const { customers, frequentCustomerIds } = await generateCustomers(tx, CONFIG, ctx.restaurant.id);
      const withCustomers: SeedContext = { ...ctx, customers, frequentCustomerIds };

      const { attendances, breaks } = await generateAttendance(tx, CONFIG, withCustomers);
      return { ctx: withCustomers, attendanceCount: attendances.length, breakCount: breaks.length };
    },
    { timeout: 150_000 },
  );
}

function logPeopleSummary(ctx: SeedContext, attendanceCount: number, breakCount: number): void {
  console.log(`  - Customers: ${ctx.customers.length} (${ctx.frequentCustomerIds.length} tagged as frequent)`);
  console.log(`  - Attendance rows: ${attendanceCount} across ${CONFIG.attendance.daysOfHistory} days`);
  console.log(`  - Attendance breaks: ${breakCount}`);
}

interface OperationsCounts {
  restockCount: number;
  adjustmentCount: number;
  cashSessionCount: number;
  shopExpenseCount: number;
  invoiceCount: number;
  paymentCount: number;
}

async function runOperationsPhase(ctx: SeedContext): Promise<{ ctx: SeedContext; counts: OperationsCounts }> {
  return prisma.$transaction(
    async (tx) => {
      const { restocks, adjustments } = await generateInventoryActivity(tx, CONFIG, ctx);
      const { cashSessions, shopExpenses } = await generateBranchOperations(tx, CONFIG, ctx);
      const { invoices, payments } = await generateVendorFinancials(tx, CONFIG, ctx);

      return {
        ctx,
        counts: {
          restockCount: restocks.length,
          adjustmentCount: adjustments.length,
          cashSessionCount: cashSessions.length,
          shopExpenseCount: shopExpenses.length,
          invoiceCount: invoices.length,
          paymentCount: payments.length,
        },
      };
    },
    { timeout: 300_000 },
  );
}

function logOperationsSummary(counts: OperationsCounts): void {
  console.log(`  - Inventory restocks (monthly JSON summaries): ${counts.restockCount}`);
  console.log(`  - Inventory adjustments (damage/wastage/expired/manual): ${counts.adjustmentCount}`);
  console.log(`  - Daily cash sessions: ${counts.cashSessionCount}`);
  console.log(`  - Shop expenses: ${counts.shopExpenseCount}`);
  console.log(`  - Vendor invoices: ${counts.invoiceCount}`);
  console.log(`  - Vendor payments: ${counts.paymentCount}`);
}

interface BillingCounts {
  billCount: number;
  runningOrderCount: number;
  stockAuditCount: number;
}

// Deliberately NOT wrapped in prisma.$transaction — see generateBillingHistory's
// docstring: at ~15k bills / ~55k line items, a single long-lived interactive
// transaction risks tripping a hosted Postgres provider's idle/duration limits.
// Each generator commits its own batches independently instead.
async function runBillingPhase(ctx: SeedContext): Promise<BillingCounts> {
  const { billCount, runningOrders, dailyIngredientConsumption } = await generateBillingHistory(prisma, CONFIG, ctx);
  const stockAudits = await generateDailyStockAudits(prisma, CONFIG, ctx, dailyIngredientConsumption);
  return { billCount, runningOrderCount: runningOrders.length, stockAuditCount: stockAudits.length };
}

function logBillingSummary(counts: BillingCounts): void {
  console.log(`  - Bills: ${counts.billCount.toLocaleString("en-IN")}`);
  console.log(`  - Running orders: ${counts.runningOrderCount.toLocaleString("en-IN")}`);
  console.log(`  - Daily stock audits (perishables only): ${counts.stockAuditCount.toLocaleString("en-IN")}`);
}

interface NewFeatureDataCounts {
  emiScheduleCount: number;
  equipmentCount: number;
  complianceRecordCount: number;
  monthlyDueCount: number;
  whatsAppMessageLogCount: number;
  leaveRequestCount: number;
  salaryDeductionCount: number;
  payrollRunCount: number;
  payrollRunLineCount: number;
  bankAccountCount: number;
  upiConfigCount: number;
  bankTransactionEntryCount: number;
}

// Equipment/Compliance/Dues/WhatsApp/Payroll/Banking — the 12 tables added by
// a later feature build than the rest of this seed script. Runs after
// Billing (Phase 7) because payroll.generator.ts and banking.generator.ts
// read real Attendance/Bill/VendorPayment rows to compute realistic
// overtime pay and reconciled transactions, rather than fabricating
// disconnected numbers.
async function runNewFeatureDataPhase(ctx: SeedContext): Promise<NewFeatureDataCounts> {
  return prisma.$transaction(
    async (tx) => {
      const emiSchedules = await generateEmiSchedules(tx, CONFIG, ctx);
      const equipment = await generateEquipment(tx, CONFIG, ctx, emiSchedules);
      const complianceRecords = await generateComplianceRecords(tx, CONFIG, ctx);
      const monthlyDues = await generateMonthlyDues(tx, CONFIG, ctx);
      const whatsAppMessageLogs = await generateWhatsAppMessageLogs(tx, CONFIG, ctx);
      const { leaveRequests, salaryDeductions, payrollRuns, payrollRunLines } = await generatePayrollData(
        tx,
        CONFIG,
        ctx,
      );
      const { bankAccounts, upiConfigs, bankTransactionEntries } = await generateBankingData(tx, CONFIG, ctx);

      return {
        emiScheduleCount: emiSchedules.length,
        equipmentCount: equipment.length,
        complianceRecordCount: complianceRecords.length,
        monthlyDueCount: monthlyDues.length,
        whatsAppMessageLogCount: whatsAppMessageLogs.length,
        leaveRequestCount: leaveRequests.length,
        salaryDeductionCount: salaryDeductions.length,
        payrollRunCount: payrollRuns.length,
        payrollRunLineCount: payrollRunLines.length,
        bankAccountCount: bankAccounts.length,
        upiConfigCount: upiConfigs.length,
        bankTransactionEntryCount: bankTransactionEntries.length,
      };
    },
    { timeout: 300_000 },
  );
}

function logNewFeatureDataSummary(counts: NewFeatureDataCounts): void {
  console.log(`  - EMI schedules: ${counts.emiScheduleCount}`);
  console.log(`  - Equipment: ${counts.equipmentCount}`);
  console.log(`  - Compliance records: ${counts.complianceRecordCount}`);
  console.log(`  - Monthly dues: ${counts.monthlyDueCount}`);
  console.log(`  - WhatsApp message logs: ${counts.whatsAppMessageLogCount}`);
  console.log(`  - Leave requests: ${counts.leaveRequestCount}`);
  console.log(`  - Salary deductions: ${counts.salaryDeductionCount}`);
  console.log(`  - Payroll runs: ${counts.payrollRunCount} (${counts.payrollRunLineCount} lines)`);
  console.log(`  - Bank accounts: ${counts.bankAccountCount}`);
  console.log(`  - UPI configs: ${counts.upiConfigCount}`);
  console.log(`  - Bank transaction entries: ${counts.bankTransactionEntryCount}`);
}

function logAnalyticsReport(report: Awaited<ReturnType<typeof validateAnalytics>>): void {
  console.log(`  - Total revenue (whole window): Rs.${Math.round(report.totalRevenue).toLocaleString("en-IN")}`);
  console.log(`  - Reference month for cost ratios: ${report.referenceMonthLabel} (Rs.${Math.round(report.referenceMonthRevenue).toLocaleString("en-IN")} revenue)`);
  console.log(`  - Food cost: ${(report.foodCostPct * 100).toFixed(1)}% (target ${(CONFIG.analytics.targetFoodCostPct * 100).toFixed(0)}%)`);
  console.log(`  - Prime cost: ${(report.primeCostPct * 100).toFixed(1)}% (target ${(CONFIG.analytics.targetPrimeCostPct * 100).toFixed(0)}%)`);
  console.log(`  - EBITDA: ${(report.ebitdaPct * 100).toFixed(1)}% (target ${(CONFIG.analytics.targetEbitdaPct * 100).toFixed(0)}%)`);
  console.log(`  - Weekend/weekday revenue-per-day ratio: ${report.weekendVsWeekdayRevenueRatio.toFixed(2)}x`);
  if (report.warnings.length === 0) {
    console.log("  - All ratios within tolerance of their configured targets.");
  } else {
    console.log(`  ! ${report.warnings.length} ratio(s) drifted outside tolerance:`);
    for (const warning of report.warnings) console.log(`      - ${warning}`);
  }
}

function logFoundationSummary(ctx: SeedContext): void {
  const totalStaff = ctx.branches.reduce((sum, b) => sum + b.staff.length, 0);
  const totalTables = ctx.branches.reduce((sum, b) => sum + b.tables.length, 0);

  console.log(`  - Restaurant: "${ctx.restaurant.name}" (id=${ctx.restaurant.id})`);
  console.log(`  - Owner: ${ctx.owner.name} <${ctx.owner.email}>`);
  console.log(`  - Discount codes: ${ctx.discountCodes.map((d) => d.code).join(", ")}`);
  for (const b of ctx.branches) {
    console.log(`  - Branch "${b.branch.name}": ${b.staff.length} staff, ${b.tables.length} tables`);
  }
  console.log(`  - Total: ${ctx.branches.length} branches, ${totalStaff} staff, ${totalTables} tables`);
  console.log("\nLogin credentials (seed data only — see src/seed/config.ts to change):");
  console.log(`  Owner:  ${ctx.owner.email} / ${CONFIG.restaurant.ownerPassword}`);
  console.log(`  Staff:  <any staff email printed above via Prisma Studio> / ${CONFIG.staffPassword}`);
}

export async function runSeed(options: RunSeedOptions = {}): Promise<void> {
  console.log("=".repeat(70));
  console.log(`DineInk seed - "${CONFIG.restaurant.name}"`);
  console.log("=".repeat(70));
  console.log(
    `Branches: ${CONFIG.branches.map((b) => b.name).join(", ")} | ` +
      `Customers: ${CONFIG.counts.customers} | MenuItems: ${CONFIG.counts.menuItems} | ` +
      `Ingredients: ${CONFIG.counts.ingredients} | Vendors: ${CONFIG.counts.vendors}`,
  );
  console.log(
    `History window: ${CONFIG.history.monthsOfHistory} months | ` +
      `Estimated total bills: ~${estimateTotalBills().toLocaleString("en-IN")}\n`,
  );

  await runStep("Verifying database connection", async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  initFaker(CONFIG.randomSeed);
  resetUniquePools();

  if (options.fresh) {
    await runStep(`Resetting demo restaurant data ("${CONFIG.demoRestaurantName}" only, --fresh)`, () =>
      // 30s was fine when this was written against a smaller dataset; at
      // 17k+ bills (and everything cascading from them) this hosted
      // Postgres instance's round-trip latency pushes the ~30 sequential
      // deleteMany() calls past that window — bumped generously rather than
      // re-tuned precisely, since a too-short timeout fails safely (the
      // whole transaction rolls back, confirmed empirically) but a
      // successful reset is what we actually need here.
      prisma.$transaction((tx) => resetDemoRestaurantData(tx, CONFIG), { timeout: 600_000 }),
    );
  } else {
    console.log('Skipping reset (pass "--fresh" to delete and recreate the demo restaurant\'s data).');
  }

  console.log("\n[Phase 2] Foundation: Restaurant, Owner, Branches, Billing Settings, Insights, Tables, Staff");
  const foundationCtx = await runStep("Creating restaurant foundation", () => runFoundationPhase());
  logFoundationSummary(foundationCtx);

  console.log("\n[Phase 3] Catalog: Menu Categories, Ingredients, Vendors");
  const { ctx: catalogCtx, priceHistoryCount } = await runStep("Creating catalog data", () => runCatalogPhase(foundationCtx));
  logCatalogSummary(catalogCtx, priceHistoryCount);

  console.log("\n[Phase 4] Menu: Menu Items, Add-On Groups, Recipes");
  const menuCtx = await runStep("Creating menu and recipes", () => runMenuPhase(catalogCtx));
  logMenuSummary(menuCtx);

  console.log("\n[Phase 5] People: Customers, Attendance");
  const { ctx: peopleCtx, attendanceCount, breakCount } = await runStep("Creating customers and attendance", () =>
    runPeoplePhase(menuCtx),
  );
  logPeopleSummary(peopleCtx, attendanceCount, breakCount);

  console.log("\n[Phase 6] Operations: Inventory, Cash Sessions, Shop Expenses, Vendor Financials");
  const { counts } = await runStep("Creating operational data", () => runOperationsPhase(peopleCtx));
  logOperationsSummary(counts);

  console.log("\n[Phase 7] Billing: Running Orders, Bills, Refunds, Daily Stock Audit (largest phase — may take a few minutes)");
  const billingCounts = await runStep("Creating billing history", () => runBillingPhase(peopleCtx));
  logBillingSummary(billingCounts);

  console.log("\n[Phase 8] Analytics Validation Report");
  const analyticsReport = await runStep("Validating seeded data against analytics targets", () =>
    validateAnalytics(prisma, CONFIG, peopleCtx),
  );
  logAnalyticsReport(analyticsReport);

  console.log("\n[Phase 9] Equipment, Compliance, Dues, WhatsApp, Payroll, Banking");
  const newFeatureCounts = await runStep("Creating equipment/compliance/dues/whatsapp/payroll/banking data", () =>
    runNewFeatureDataPhase(peopleCtx),
  );
  logNewFeatureDataSummary(newFeatureCounts);

  console.log("\nSeed plan:");
  for (const step of SEED_PLAN) {
    console.log(`  [Phase ${step.phase}] ${step.label} - ${step.done ? "done" : "pending"}`);
  }

  console.log("\nAll 8 phases complete.");
}
