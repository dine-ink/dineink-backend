import type { DailyCashSession, Prisma, ShopExpense, User } from "../../../generated/prisma";
import type { BranchContext } from "../context";
import type { SeedConfig } from "../config";
import type { SeedContext } from "../context";
import {
  batchCreateManyAndReturn,
  chance,
  type Db,
  historyDateRange,
  historyMonths,
  isWeekend,
  pickOne,
  randomFloat,
  randomInt,
  randomTimeOnDay,
  toUtcMidnight,
  weightedPick,
} from "../utils";

export interface BranchOperationsResult {
  cashSessions: DailyCashSession[];
  shopExpenses: ShopExpense[];
}

const PAYMENT_SOURCE_MIX = { CASH: 0.3, BANK_TRANSFER: 0.35, UPI: 0.2, EMPLOYEE_PAID: 0.15 };

const AD_HOC_EXPENSES: Array<{ title: string; expenseType: string; range: [number, number] }> = [
  { title: "Stationery Purchase", expenseType: "OFFICE_SUPPLIES", range: [200, 800] },
  { title: "AC Repair", expenseType: "MAINTENANCE", range: [1000, 3000] },
  { title: "Pest Control Service", expenseType: "MAINTENANCE", range: [800, 2000] },
  { title: "Signage Repair", expenseType: "MAINTENANCE", range: [500, 2500] },
  { title: "Uniform Purchase", expenseType: "MISCELLANEOUS", range: [1000, 3000] },
  { title: "Cutlery Replacement", expenseType: "MISCELLANEOUS", range: [500, 1500] },
  { title: "Plumbing Repair", expenseType: "MAINTENANCE", range: [500, 2000] },
  { title: "Deep Cleaning Service", expenseType: "MISCELLANEOUS", range: [1500, 4000] },
];

function openCloseHours(branchCtx: BranchContext): { openHour: number; closeHour: number } {
  const branch = branchCtx.branch;
  return {
    openHour: branch.openingTime ? parseInt(branch.openingTime.split(":")[0], 10) : 10,
    closeHour: branch.closingTime ? parseInt(branch.closingTime.split(":")[0], 10) : 23,
  };
}

function pickPayer(staff: User[]): User | null {
  const manager = staff.find((s) => s.role === "MANAGER");
  return manager ?? (staff.length > 0 ? pickOne(staff) : null);
}

function buildCashSessions(config: SeedConfig, ctx: SeedContext): Prisma.DailyCashSessionCreateManyInput[] {
  const days = historyDateRange(config.history.monthsOfHistory);
  const lastDay = days[days.length - 1];
  const rows: Prisma.DailyCashSessionCreateManyInput[] = [];

  for (const branchCtx of ctx.branches) {
    const cashiers = branchCtx.staff.filter((s) => s.role === "CASHIER");
    if (cashiers.length === 0) continue;
    const { openHour, closeHour } = openCloseHours(branchCtx);
    const manager = branchCtx.staff.find((s) => s.role === "MANAGER");

    const estimatedDailyRevenue = (day: Date) =>
      (isWeekend(day) ? config.history.weekendBillsPerBranchPerDay : config.history.weekdayBillsPerBranchPerDay) *
      config.billing.averageBillAmount;

    days.forEach((day) => {
      const isLastDay = day.getTime() === lastDay.getTime();

      cashiers.forEach((cashier, cashierIndex) => {
        const keepOpen = isLastDay && cashierIndex === 0;
        const openingCash = randomFloat(2000, 5000);
        const openedAt = randomTimeOnDay(day, openHour, openHour + 1);

        if (keepOpen) {
          rows.push({
            restaurantId: ctx.restaurant.id,
            branchId: branchCtx.branch.id,
            openedById: cashier.id,
            businessDate: toUtcMidnight(day),
            openingCash,
            openedAt,
            status: "OPEN",
          });
          return;
        }

        const cashShareOfRevenue =
          (estimatedDailyRevenue(day) / cashiers.length) * config.billing.paymentMethodMix.CASH * randomFloat(0.85, 1.15);
        const expectedCash = openingCash + cashShareOfRevenue;
        const cashDifference = chance(0.9) ? randomFloat(-100, 100) : randomFloat(-500, 500);
        const actualCash = expectedCash + cashDifference;

        rows.push({
          restaurantId: ctx.restaurant.id,
          branchId: branchCtx.branch.id,
          openedById: cashier.id,
          closedById: chance(0.9) || !manager ? cashier.id : manager.id,
          businessDate: toUtcMidnight(day),
          openingCash: Math.round(openingCash * 100) / 100,
          expectedCash: Math.round(expectedCash * 100) / 100,
          actualCash: Math.round(actualCash * 100) / 100,
          closingCash: Math.round(actualCash * 100) / 100,
          cashDifference: Math.round(cashDifference * 100) / 100,
          openedAt,
          closedAt: randomTimeOnDay(day, Math.max(openHour + 1, closeHour - 1), closeHour),
          status: "CLOSED",
        });
      });
    });
  }

  return rows;
}

function buildShopExpenses(config: SeedConfig, ctx: SeedContext): Prisma.ShopExpenseCreateManyInput[] {
  const rows: Prisma.ShopExpenseCreateManyInput[] = [];

  for (const branchCtx of ctx.branches) {
    const { insights } = branchCtx;
    const createdBy = pickPayer(branchCtx.staff);
    const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();

    const addExpense = (
      year: number,
      month: number,
      day: number,
      title: string,
      expenseType: string,
      amount: number,
    ) => {
      const paymentSource = weightedPick(PAYMENT_SOURCE_MIX);
      const payer = paymentSource === "EMPLOYEE_PAID" ? pickPayer(branchCtx.staff) : null;
      rows.push({
        restaurantId: ctx.restaurant.id,
        branchId: branchCtx.branch.id,
        title,
        amount: Math.round(amount * 100) / 100,
        expenseType,
        paymentSource,
        paidByUserId: payer?.id ?? null,
        expenseDate: new Date(year, month - 1, day),
        createdById: createdBy?.id ?? null,
      });
    };

    for (const { month, year } of historyMonths(config.history.monthsOfHistory)) {
      const lastDay = daysInMonth(year, month);

      addExpense(year, month, randomInt(1, 5), "Shop Rent", "RENT", insights.monthlyRent ?? 30000);
      addExpense(
        year,
        month,
        randomInt(5, 10),
        "Electricity Bill",
        "UTILITIES",
        (insights.electricity ?? 18000) * randomFloat(0.9, 1.1),
      );
      addExpense(year, month, randomInt(1, 5), "Internet Bill", "UTILITIES", insights.internet ?? 2500);

      const gasRefills = randomInt(1, 2);
      for (let i = 0; i < gasRefills; i++) {
        addExpense(
          year,
          month,
          randomInt(1, lastDay),
          "LPG Gas Refill",
          "UTILITIES",
          ((insights.gas ?? 10000) / gasRefills) * randomFloat(0.9, 1.1),
        );
      }

      const maintenanceCount = randomInt(1, 2);
      for (let i = 0; i < maintenanceCount; i++) {
        addExpense(
          year,
          month,
          randomInt(1, lastDay),
          "Equipment Maintenance",
          "MAINTENANCE",
          (insights.maintenance ?? 7000) / maintenanceCount,
        );
      }

      addExpense(
        year,
        month,
        randomInt(1, 10),
        "Marketing & Promotions",
        "MARKETING",
        (insights.marketingSpend ?? 15000) * randomFloat(0.8, 1.2),
      );

      // The remaining RestaurantInsights fields — omitting these was the bug
      // that left EBITDA more than double its target: aggregatorCommission
      // and deliveryCharges alone are typically the single largest variable
      // costs a delivery-heavy restaurant carries.
      addExpense(
        year,
        month,
        randomInt(1, lastDay),
        "Delivery Partner Charges",
        "DELIVERY",
        (insights.deliveryCharges ?? 20000) * randomFloat(0.9, 1.1),
      );
      addExpense(
        year,
        month,
        randomInt(1, lastDay),
        "Aggregator Commission (Swiggy/Zomato)",
        "PLATFORM_FEES",
        (insights.aggregatorCommission ?? 40000) * randomFloat(0.9, 1.1),
      );
      addExpense(
        year,
        month,
        randomInt(1, 10),
        "Packaging Supplies",
        "PACKAGING",
        (insights.packaging ?? 15000) * randomFloat(0.85, 1.15),
      );
      addExpense(
        year,
        month,
        randomInt(1, 10),
        "Payment Gateway Charges",
        "PAYMENT_PROCESSING",
        (insights.paymentGateway ?? 8000) * randomFloat(0.9, 1.1),
      );
      addExpense(year, month, randomInt(1, 5), "Phone/Landline Bill", "UTILITIES", insights.phoneBills ?? 1800);
      addExpense(year, month, randomInt(1, 10), "Accounting & CA Fees", "PROFESSIONAL_FEES", insights.accounting ?? 6000);
      addExpense(year, month, randomInt(1, 10), "Insurance Premium", "INSURANCE", insights.insurance ?? 3500);
      addExpense(year, month, randomInt(1, 10), "License & Compliance Fees", "LICENSES", insights.licenses ?? 3000);
      addExpense(year, month, randomInt(1, lastDay), "Fuel (Delivery/Generator)", "FUEL", insights.fuel ?? 4000);

      const adHocCount = randomInt(3, 6);
      for (let i = 0; i < adHocCount; i++) {
        const pick = pickOne(AD_HOC_EXPENSES);
        addExpense(year, month, randomInt(1, lastDay), pick.title, pick.expenseType, randomFloat(pick.range[0], pick.range[1]));
      }
    }
  }

  return rows;
}

/**
 * Owns: DailyCashSession (one open/close cycle per cashier per business day
 * — deliberately NOT reconciled against real Bill totals, since Bills don't
 * exist until Phase 7 and this schema has no FK between the two; expected/
 * actual cash are synthesized from config.billing/config.history directly)
 * and ShopExpense (rent/utilities/maintenance/marketing recurring monthly,
 * reusing each branch's own RestaurantInsights estimates for internal
 * consistency, plus a handful of ad-hoc small expenses per month).
 *
 * Idempotent: generates once per restaurant, checked via a plain count().
 */
export async function generateBranchOperations(db: Db, config: SeedConfig, ctx: SeedContext): Promise<BranchOperationsResult> {
  const existingCount = await db.dailyCashSession.count({ where: { restaurantId: ctx.restaurant.id } });
  if (existingCount > 0) {
    const [cashSessions, shopExpenses] = await Promise.all([
      db.dailyCashSession.findMany({ where: { restaurantId: ctx.restaurant.id } }),
      db.shopExpense.findMany({ where: { restaurantId: ctx.restaurant.id } }),
    ]);
    return { cashSessions, shopExpenses };
  }

  const cashSessions = await batchCreateManyAndReturn(buildCashSessions(config, ctx), (chunk) =>
    db.dailyCashSession.createManyAndReturn({ data: chunk }),
  );
  const shopExpenses = await batchCreateManyAndReturn(buildShopExpenses(config, ctx), (chunk) =>
    db.shopExpense.createManyAndReturn({ data: chunk }),
  );

  return { cashSessions, shopExpenses };
}
