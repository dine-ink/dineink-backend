import type {
  AddOn,
  BillingSettings,
  DiscountCode,
  MenuItem,
  MenuItemIngredient,
  Prisma,
  RunningOrder,
  User,
} from "../../../generated/prisma";
import type { SeedConfig } from "../config";
import type { BranchContext, SeedContext } from "../context";
import {
  addMinutes,
  batchCreateManyAndReturn,
  chance,
  type Db,
  historyDateRange,
  isWeekend,
  pickOne,
  randomFloat,
  randomInt,
  sampleUnique,
  weightedPick,
  weightedPickNumber,
} from "../utils";

export interface BillingSeedResult {
  runningOrders: RunningOrder[];
  billCount: number;
  /** branchId -> "yyyy-mm-dd" -> ingredientId -> qty consumed that day (recipe qty x billed qty). Feeds generateDailyStockAudits() so it doesn't have to re-join BillItem x MenuItemIngredient itself. */
  dailyIngredientConsumption: Map<number, Map<string, Map<number, number>>>;
}

interface AddOnOption {
  name: string;
  price: number;
}

interface LineItemPlan {
  menuItemId: number;
  itemName: string;
  quantity: number;
  price: number;
  total: number;
  addOns: AddOnOption[];
}

interface DiscountResult {
  discountAmount: number;
  discountType: string;
  discountCode: string | null;
  discountApprovedById: number | null;
}

interface TransactionPlan {
  branchId: number;
  restaurantId: number;
  tableId: number | null;
  orderType: string;
  paymentMethod: string;
  items: LineItemPlan[];
  subtotal: number;
  discount: DiscountResult;
  serviceCharge: number;
  packingCharge: number;
  gst: number;
  cgst: number;
  sgst: number;
  total: number;
  tipAmount: number;
  customerId: number | null;
  createdById: number | null;
  orderCreatedAt: Date;
  billCreatedAt: Date;
  refundAmount: number | null;
}

const NO_DISCOUNT: DiscountResult = { discountAmount: 0, discountType: "PERCENTAGE", discountCode: null, discountApprovedById: null };

function branchCode(branchName: string): string {
  return branchName.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 3) || "BR";
}

function financialYearFor(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return String(month >= 4 ? year : year - 1);
}

/** Lunch (12-13h) and dinner (19-21h) get 3x the weight of other open hours. */
function hourWeights(openHour: number, closeHour: number): Record<number, number> {
  const weights: Record<number, number> = {};
  for (let h = openHour; h < closeHour; h++) {
    weights[h] = h === 12 || h === 13 || (h >= 19 && h <= 21) ? 3 : 1;
  }
  return weights;
}

function randomBusinessTime(day: Date, openHour: number, closeHour: number): Date {
  const hour = weightedPickNumber(hourWeights(openHour, Math.max(openHour + 1, closeHour)));
  const d = new Date(day);
  d.setHours(hour, randomInt(0, 59), randomInt(0, 59), 0);
  return d;
}

function buildAddOnsByMenuItem(ctx: SeedContext): Map<number, AddOnOption[]> {
  const addOnsByGroup = new Map<number, AddOnOption[]>();
  for (const addOn of ctx.addOns as AddOn[]) {
    addOnsByGroup.set(addOn.addOnGroupId, [...(addOnsByGroup.get(addOn.addOnGroupId) ?? []), { name: addOn.name, price: addOn.price }]);
  }
  const byMenuItem = new Map<number, AddOnOption[]>();
  for (const link of ctx.menuItemAddOnGroups) {
    const options = addOnsByGroup.get(link.addOnGroupId) ?? [];
    byMenuItem.set(link.menuItemId, [...(byMenuItem.get(link.menuItemId) ?? []), ...options]);
  }
  return byMenuItem;
}

function buildLineItems(
  config: SeedConfig,
  menuItems: MenuItem[],
  addOnsByMenuItem: Map<number, AddOnOption[]>,
): { items: LineItemPlan[]; subtotal: number } {
  const [minItems, maxItems] = config.billing.itemsPerBillRange;
  const chosen = sampleUnique(menuItems, randomInt(minItems, maxItems));

  const items: LineItemPlan[] = chosen.map((menuItem) => {
    // Mostly 1 — repeating the exact same dish on its own line is less
    // common than ordering another distinct item; kept just under 1.0x avg
    // to land the bill total near config.billing.averageBillAmount given
    // real seeded menu prices (~₹182 avg) x itemsPerBillRange (~3.5 avg).
    const quantity = weightedPickNumber({ 1: 0.95, 2: 0.05 });
    const available = addOnsByMenuItem.get(menuItem.id) ?? [];
    const addOns = available.length > 0 && chance(0.3) ? sampleUnique(available, randomInt(1, Math.min(2, available.length))) : [];
    const addOnsTotal = addOns.reduce((sum, a) => sum + a.price, 0);
    // Matches runningOrder.service.ts's lineTotal(): qty x (price + sum(addOn prices)).
    const total = Math.round(quantity * (menuItem.price + addOnsTotal) * 100) / 100;
    return { menuItemId: menuItem.id, itemName: menuItem.name, quantity, price: menuItem.price, total, addOns };
  });

  return { items, subtotal: Math.round(items.reduce((sum, i) => sum + i.total, 0) * 100) / 100 };
}

function computeDiscount(
  config: SeedConfig,
  subtotal: number,
  billingSettings: BillingSettings,
  discountCodes: DiscountCode[],
  couponUsage: Map<string, number>,
  manager: User | undefined,
): DiscountResult {
  if (!chance(config.billing.discountProbability)) return NO_DISCOUNT;

  let kind: string = weightedPick(config.billing.discountKindMix);

  if (kind === "COUPON") {
    const available = discountCodes.filter((c) => {
      const used = couponUsage.get(c.code) ?? c.usedCount;
      return c.maxUses === null || used < c.maxUses;
    });
    if (available.length === 0) {
      kind = "PERCENTAGE"; // every code is maxed out — fall back rather than skip the discount entirely
    } else {
      const code = pickOne(available);
      couponUsage.set(code.code, (couponUsage.get(code.code) ?? code.usedCount) + 1);
      const discountAmount =
        code.type === "FIXED" ? Math.min(code.value, subtotal) : Math.round(((subtotal * code.value) / 100) * 100) / 100;
      return { discountAmount, discountType: code.type, discountCode: code.code, discountApprovedById: null };
    }
  }

  if (kind === "FIXED") {
    return {
      discountAmount: Math.min(Math.round(randomFloat(50, 150) * 100) / 100, subtotal),
      discountType: "FIXED",
      discountCode: null,
      discountApprovedById: null,
    };
  }

  // PERCENTAGE — mirrors BillingSettings.discountApprovalThreshold: a manual
  // % discount above the threshold needs a manager's approval id recorded.
  const pct = randomFloat(5, 30);
  const threshold = billingSettings.discountApprovalThreshold ?? 20;
  return {
    discountAmount: Math.round(subtotal * (pct / 100) * 100) / 100,
    discountType: "PERCENTAGE",
    discountCode: null,
    discountApprovedById: pct > threshold ? (manager?.id ?? null) : null,
  };
}

function pickCustomer(ctx: SeedContext): number | null {
  if (!chance(0.4)) return null;
  if (ctx.frequentCustomerIds.length > 0 && chance(0.6)) return pickOne(ctx.frequentCustomerIds);
  return ctx.customers.length > 0 ? pickOne(ctx.customers).id : null;
}

function pickCreator(staff: User[]): number | null {
  if (staff.length === 0) return null;
  const role = weightedPick({ CASHIER: 0.7, WAITER: 0.2, MANAGER: 0.1 });
  const candidates = staff.filter((s) => s.role === role);
  return (candidates.length > 0 ? pickOne(candidates) : pickOne(staff)).id;
}

function buildTransactionPlan(
  config: SeedConfig,
  ctx: SeedContext,
  branchCtx: BranchContext,
  day: Date,
  addOnsByMenuItem: Map<number, AddOnOption[]>,
  couponUsage: Map<string, number>,
): TransactionPlan {
  const openHour = branchCtx.branch.openingTime ? parseInt(branchCtx.branch.openingTime.split(":")[0], 10) : 10;
  const closeHour = branchCtx.branch.closingTime ? parseInt(branchCtx.branch.closingTime.split(":")[0], 10) : 23;

  const orderType = weightedPick(config.billing.orderTypeMix);
  const paymentMethod = weightedPick(config.billing.paymentMethodMix);
  const manager = branchCtx.staff.find((s) => s.role === "MANAGER");

  const { items, subtotal } = buildLineItems(config, ctx.menuItems, addOnsByMenuItem);
  const discount = computeDiscount(config, subtotal, branchCtx.billingSettings, ctx.discountCodes, couponUsage, manager);

  const taxableAmount = Math.max(0, subtotal - discount.discountAmount);
  const serviceCharge = Math.round(taxableAmount * ((branchCtx.billingSettings.serviceCharge ?? 0) / 100) * 100) / 100;
  const gst = Math.round((taxableAmount + serviceCharge) * ((branchCtx.billingSettings.gstPercentage ?? 5) / 100) * 100) / 100;
  const cgst = Math.round((gst / 2) * 100) / 100;
  const sgst = Math.round((gst - cgst) * 100) / 100;
  const packingCharge = orderType !== "DINE_IN" ? Math.round(randomFloat(10, 30) * 100) / 100 : 0;
  const total = Math.round((taxableAmount + serviceCharge + gst + packingCharge) * 100) / 100;
  const tipAmount = chance(config.billing.tipProbability)
    ? Math.round(total * randomFloat(config.billing.tipPctOfTotalRange[0], config.billing.tipPctOfTotalRange[1]) * 100) / 100
    : 0;

  const orderCreatedAt = randomBusinessTime(day, openHour, closeHour);
  const prepMinutes = orderType === "DINE_IN" ? randomInt(25, 75) : randomInt(5, 20);

  return {
    branchId: branchCtx.branch.id,
    restaurantId: ctx.restaurant.id,
    tableId: orderType === "DINE_IN" && branchCtx.tables.length > 0 ? pickOne(branchCtx.tables).id : null,
    orderType,
    paymentMethod,
    items,
    subtotal,
    discount,
    serviceCharge,
    packingCharge,
    gst,
    cgst,
    sgst,
    total,
    tipAmount,
    customerId: pickCustomer(ctx),
    createdById: pickCreator(branchCtx.staff),
    orderCreatedAt,
    billCreatedAt: addMinutes(orderCreatedAt, prepMinutes),
    refundAmount: chance(config.billing.refundProbability) ? Math.round(total * randomFloat(0.1, 0.5) * 100) / 100 : null,
  };
}

/**
 * Owns: RunningOrder + RunningOrderBatch + RunningOrderBatchItem +
 * RunningOrderBatchItemAddOn, Bill + BillItem + BillItemAddOn + BillRefund,
 * and InvoiceSequence bookkeeping (sequential per branch+financial-year,
 * matching invoiceNumber.service.ts's format — but keyed off each
 * transaction's own historical date rather than "today", since that
 * service always uses the real current date and this needs 3 months of
 * correctly-dated invoice numbers instead).
 *
 * Also deliberately does NOT create a "SALE_DEDUCTION" InventoryAdjustment
 * per ingredient per bill (what the real bill.service.ts/runningOrder.
 * service.ts do on every paid bill) or decrement live Ingredient.quantity —
 * at this volume (~15k bills x ~8-12 distinct ingredients each) that's
 * 150k+ audit rows and would drive every ingredient deeply negative, since
 * Ingredient.quantity was seeded in Phase 3 as a plausible *current*
 * snapshot, not a ledger balanced against 3 months of restocks vs sales.
 * Ingredient consumption is instead tracked in-memory (see
 * dailyIngredientConsumption) purely to feed generateDailyStockAudits()'s
 * sopConsumed number, without touching the live stock figure.
 *
 * Idempotent: generates once per restaurant, checked via a plain count().
 * NOT wrapped in a single transaction (unlike every earlier phase) — at
 * this row count a single interactive transaction risks tripping a hosted
 * Postgres provider's idle/statement-duration limits; each table's batch
 * insert commits independently instead. A failed run should be cleaned up
 * with --fresh rather than replayed in place.
 */
export async function generateBillingHistory(db: Db, config: SeedConfig, ctx: SeedContext): Promise<BillingSeedResult> {
  const existingCount = await db.bill.count({ where: { restaurantId: ctx.restaurant.id } });
  if (existingCount > 0) {
    return { runningOrders: [], billCount: existingCount, dailyIngredientConsumption: new Map() };
  }

  const addOnsByMenuItem = buildAddOnsByMenuItem(ctx);
  const recipeByMenuItemId = new Map<number, MenuItemIngredient[]>();
  for (const recipe of ctx.menuItemIngredients) {
    recipeByMenuItemId.set(recipe.menuItemId, [...(recipeByMenuItemId.get(recipe.menuItemId) ?? []), recipe]);
  }
  const couponUsage = new Map<string, number>();
  const days = historyDateRange(config.history.monthsOfHistory);
  const firstDay = days[0];

  const plans: TransactionPlan[] = [];
  for (const branchCtx of ctx.branches) {
    for (const day of days) {
      const monthsElapsed = (day.getFullYear() - firstDay.getFullYear()) * 12 + (day.getMonth() - firstDay.getMonth());
      const growth = (1 + config.analytics.monthlyRevenueGrowthPct) ** monthsElapsed;
      const baseCount = isWeekend(day) ? config.history.weekendBillsPerBranchPerDay : config.history.weekdayBillsPerBranchPerDay;
      const billCount = Math.round(baseCount * growth);

      for (let i = 0; i < billCount; i++) {
        plans.push(buildTransactionPlan(config, ctx, branchCtx, day, addOnsByMenuItem, couponUsage));
      }
    }
  }

  // ── InvoiceSequence bookkeeping — plans are already chronological per branch (nested day loop above), so assigning billNo in array order is assigning it in true date order. ──
  const sequenceState = new Map<string, number>(); // `${branchId}:${FY}` -> lastNumber
  for (const branchCtx of ctx.branches) {
    for (const fy of new Set(plans.filter((p) => p.branchId === branchCtx.branch.id).map((p) => financialYearFor(p.billCreatedAt)))) {
      const existing = await db.invoiceSequence.findUnique({
        where: { branchId_financialYear: { branchId: branchCtx.branch.id, financialYear: fy } },
      });
      sequenceState.set(`${branchCtx.branch.id}:${fy}`, existing?.lastNumber ?? 0);
    }
  }

  const branchCodeById = new Map(ctx.branches.map((b) => [b.branch.id, branchCode(b.branch.name)]));

  const billRows: Prisma.BillCreateManyInput[] = [];
  for (const plan of plans) {
    const fy = financialYearFor(plan.billCreatedAt);
    const key = `${plan.branchId}:${fy}`;
    const nextNumber = (sequenceState.get(key) ?? 0) + 1;
    sequenceState.set(key, nextNumber);
    // NOTE: the real invoiceNumber.service.ts formats this as `INV-{FY}-{seq}`
    // with NO branch component, even though its InvoiceSequence is scoped
    // per (branchId, financialYear) — so two branches both issuing their
    // "bill #1" in the same FY produce the identical billNo, which collides
    // against Bill.billNo's *global* unique constraint the moment a
    // restaurant has more than one branch. Confirmed by hitting exactly this
    // P2002 on the first seeding attempt. This is a real bug worth fixing in
    // invoiceNumber.service.ts itself; the seed works around it here by
    // including a branch code so historical data doesn't collide (and won't
    // collide with whatever the live buggy function generates next, either).
    const billNo = `INV-${branchCodeById.get(plan.branchId) ?? "BR"}-${fy}-${String(nextNumber).padStart(6, "0")}`;

    billRows.push({
      billNo,
      restaurantId: plan.restaurantId,
      branchId: plan.branchId,
      customerId: plan.customerId,
      createdById: plan.createdById,
      status: "PAID",
      orderStatus: "COMPLETED",
      subtotal: plan.subtotal,
      gst: plan.gst,
      cgst: plan.cgst,
      sgst: plan.sgst,
      serviceCharge: plan.serviceCharge,
      packingCharge: plan.packingCharge,
      discount: plan.discount.discountAmount,
      discountType: plan.discount.discountType,
      discountCode: plan.discount.discountCode,
      discountApprovedById: plan.discount.discountApprovedById,
      total: plan.refundAmount ? Math.max(0, plan.total - plan.refundAmount) : plan.total,
      refundedAmount: plan.refundAmount ?? 0,
      tipAmount: plan.tipAmount,
      paymentMethod: plan.paymentMethod,
      orderType: plan.orderType,
      createdAt: plan.billCreatedAt,
    });
  }
  const bills = await batchCreateManyAndReturn(billRows, (chunk) => db.bill.createManyAndReturn({ data: chunk }));

  const billItemRows: Prisma.BillItemCreateManyInput[] = [];
  const billItemAddOnPlans: Array<{ billIndex: number; itemIndex: number; addOns: AddOnOption[] }> = [];
  plans.forEach((plan, billIndex) => {
    plan.items.forEach((item, itemIndex) => {
      billItemRows.push({
        billId: bills[billIndex].id,
        menuItemId: item.menuItemId,
        itemName: item.itemName,
        quantity: item.quantity,
        price: item.price,
        total: item.total,
        createdAt: plan.billCreatedAt,
      });
      if (item.addOns.length > 0) billItemAddOnPlans.push({ billIndex, itemIndex, addOns: item.addOns });
    });
  });
  const billItems = await batchCreateManyAndReturn(billItemRows, (chunk) => db.billItem.createManyAndReturn({ data: chunk }));

  // Re-derive each BillItem's position in billItemRows to attach add-ons to the right row.
  let billItemCursor = 0;
  const billItemIdByPlanItem = new Map<string, number>();
  plans.forEach((plan, billIndex) => {
    plan.items.forEach((_item, itemIndex) => {
      billItemIdByPlanItem.set(`${billIndex}:${itemIndex}`, billItems[billItemCursor].id);
      billItemCursor += 1;
    });
  });

  const billItemAddOnRows: Prisma.BillItemAddOnCreateManyInput[] = billItemAddOnPlans.flatMap(({ billIndex, itemIndex, addOns }) =>
    addOns.map((a) => ({
      billItemId: billItemIdByPlanItem.get(`${billIndex}:${itemIndex}`)!,
      name: a.name,
      price: a.price,
      createdAt: plans[billIndex].billCreatedAt,
    })),
  );
  await batchCreateManyAndReturn(billItemAddOnRows, (chunk) => db.billItemAddOn.createManyAndReturn({ data: chunk }));

  const refundRows: Prisma.BillRefundCreateManyInput[] = [];
  plans.forEach((plan, billIndex) => {
    if (!plan.refundAmount) return;
    refundRows.push({
      billId: bills[billIndex].id,
      amount: plan.refundAmount,
      reason: pickOne(["Guest complaint", "Wrong item served", "Order cancelled after billing", "Quality issue"]),
      createdById: plan.createdById,
      createdAt: addMinutes(plan.billCreatedAt, randomInt(10, 240)),
    });
  });
  await batchCreateManyAndReturn(refundRows, (chunk) => db.billRefund.createManyAndReturn({ data: chunk }));

  // ── RunningOrder side — billId is a loose (non-relation) column, so it can be set straight at create time; no separate update pass needed. ──
  const runningOrderRows: Prisma.RunningOrderCreateManyInput[] = plans.map((plan, billIndex) => {
    const isNotDineIn = plan.orderType !== "DINE_IN";
    return {
      restaurantId: plan.restaurantId,
      branchId: plan.branchId,
      tableId: plan.tableId,
      orderType: plan.orderType,
      paymentMethod: plan.paymentMethod,
      paymentStatus: isNotDineIn ? "PAID" : "UNPAID", // faithfully matches saveRunningOrderService — never flipped afterward even once billed, for either path
      status: "CLOSED",
      kitchenStatus: "READY",
      subtotal: isNotDineIn ? plan.subtotal : null,
      discountAmount: isNotDineIn ? plan.discount.discountAmount : null,
      packingCharge: isNotDineIn ? plan.packingCharge : null,
      serviceCharge: isNotDineIn ? plan.serviceCharge : null,
      gstAmount: isNotDineIn ? plan.gst : null,
      cgst: isNotDineIn ? plan.cgst : null,
      sgst: isNotDineIn ? plan.sgst : null,
      finalAmount: isNotDineIn ? plan.total : null,
      tipAmount: isNotDineIn ? plan.tipAmount : null,
      totalAmount: plan.subtotal,
      createdById: plan.createdById,
      billId: bills[billIndex].id,
      startedAt: plan.orderCreatedAt,
      completedAt: plan.billCreatedAt,
      createdAt: plan.orderCreatedAt,
    };
  });
  const runningOrders = await batchCreateManyAndReturn(runningOrderRows, (chunk) => db.runningOrder.createManyAndReturn({ data: chunk }));

  const batchRows: Prisma.RunningOrderBatchCreateManyInput[] = runningOrders.map((ro, i) => ({
    runningOrderId: ro.id,
    createdAt: plans[i].orderCreatedAt,
  }));
  const batches = await batchCreateManyAndReturn(batchRows, (chunk) => db.runningOrderBatch.createManyAndReturn({ data: chunk }));

  const batchItemRows: Prisma.RunningOrderBatchItemCreateManyInput[] = [];
  const batchItemAddOnPlans: Array<{ index: number; addOns: AddOnOption[] }> = [];
  plans.forEach((plan, billIndex) => {
    plan.items.forEach((item) => {
      batchItemAddOnPlans.push({ index: batchItemRows.length, addOns: item.addOns });
      batchItemRows.push({
        runningOrderBatchId: batches[billIndex].id,
        menuItemId: item.menuItemId,
        itemName: item.itemName,
        quantity: item.quantity,
        price: item.price,
        total: item.total,
        status: "DONE",
        createdAt: plan.orderCreatedAt,
      });
    });
  });
  const batchItems = await batchCreateManyAndReturn(batchItemRows, (chunk) => db.runningOrderBatchItem.createManyAndReturn({ data: chunk }));

  const batchItemAddOnRows: Prisma.RunningOrderBatchItemAddOnCreateManyInput[] = batchItemAddOnPlans.flatMap(({ index, addOns }) =>
    addOns.map((a) => ({ runningOrderBatchItemId: batchItems[index].id, name: a.name, price: a.price })),
  );
  await batchCreateManyAndReturn(batchItemAddOnRows, (chunk) => db.runningOrderBatchItemAddOn.createManyAndReturn({ data: chunk }));

  // ── Persist final InvoiceSequence + DiscountCode.usedCount state ──
  for (const [key, lastNumber] of sequenceState) {
    const [branchIdStr, financialYear] = key.split(":");
    const branchId = Number(branchIdStr);
    await db.invoiceSequence.upsert({
      where: { branchId_financialYear: { branchId, financialYear } },
      create: { restaurantId: ctx.restaurant.id, branchId, financialYear, lastNumber },
      update: { lastNumber },
    });
  }
  for (const [code, count] of couponUsage) {
    await db.discountCode.update({ where: { restaurantId_code: { restaurantId: ctx.restaurant.id, code } }, data: { usedCount: { increment: count } } });
  }

  // ── In-memory ingredient consumption per branch/day, for generateDailyStockAudits ──
  const dailyIngredientConsumption = new Map<number, Map<string, Map<number, number>>>();
  plans.forEach((plan) => {
    const dateKey = plan.billCreatedAt.toISOString().slice(0, 10);
    const branchMap = dailyIngredientConsumption.get(plan.branchId) ?? new Map<string, Map<number, number>>();
    const dayMap = branchMap.get(dateKey) ?? new Map<number, number>();
    for (const item of plan.items) {
      for (const recipe of recipeByMenuItemId.get(item.menuItemId) ?? []) {
        dayMap.set(recipe.ingredientId, (dayMap.get(recipe.ingredientId) ?? 0) + recipe.quantity * item.quantity);
      }
    }
    branchMap.set(dateKey, dayMap);
    dailyIngredientConsumption.set(plan.branchId, branchMap);
  });

  return { runningOrders, billCount: bills.length, dailyIngredientConsumption };
}
