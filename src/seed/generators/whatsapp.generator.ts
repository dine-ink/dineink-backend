import type { Customer, Prisma, Vendor, WhatsAppMessageLog } from "../../../generated/prisma";
import type { SeedConfig } from "../config";
import type { SeedContext } from "../context";
import {
  batchCreateManyAndReturn,
  chance,
  type Db,
  historyDateRange,
  pickOne,
  randomInt,
  randomTimeOnDay,
  weightedPick,
} from "../utils";

type TemplateType = "CUSTOMER_MARKETING" | "VENDOR_EBILL" | "VENDOR_PAYMENT" | "GST_UPDATE";

// How the generated rows split across the four template types. Skewed
// heavily toward CUSTOMER_MARKETING (that's the WhatsApp feature's main real
// use case — promos/reminders), with vendor e-bill/payment nudges and a
// handful of restaurant-wide GST reminders rounding things out.
const TEMPLATE_TYPE_MIX: Record<TemplateType, number> = {
  CUSTOMER_MARKETING: 0.65,
  VENDOR_EBILL: 0.13,
  VENDOR_PAYMENT: 0.12,
  GST_UPDATE: 0.1,
};

// Total row count for the whole run — hardcoded here (not in config.ts,
// per the task's scope limit) since this is a low-volume, mostly-cosmetic
// log rather than a core dataset other generators depend on.
const TOTAL_ROWS_RANGE: [number, number] = [30, 60];

const CUSTOMER_MARKETING_MESSAGES = [
  "Hi {name}, thank you for dining with us! Enjoy 20% off your next visit at DineInk this weekend.",
  "Reminder: your table at DineInk is ready. See you soon!",
  "DineInk here — we miss you! Come back this week for a free dessert on your next order.",
  "Happy Weekend, {name}! Flat 15% off on all orders above Rs.500 at DineInk today.",
  "Hi {name}, your feedback matters — rate your last visit to DineInk and get a surprise coupon.",
];

const VENDOR_EBILL_MESSAGES = [
  "Hi {name}, please share this month's invoice/e-bill for our records at DineInk.",
  "Kind reminder to send the pending e-bill for last week's supply, {name}.",
  "Hi {name}, could you resend the e-bill for the most recent delivery? Thanks - DineInk",
];

const VENDOR_PAYMENT_MESSAGES = [
  "Hi {name}, a payment of Rs.{amount} has been processed to your account for recent supplies. Thank you - DineInk",
  "Payment of Rs.{amount} has been transferred via UPI, {name}. Please confirm receipt.",
  "Hi {name}, your outstanding invoice has been settled - Rs.{amount} paid. - DineInk",
];

const GST_UPDATE_MESSAGES = [
  "GST filing reminder: please review and file GST returns for this month before the due date.",
  "GSTIN details updated for DineInk. Please verify the registration information on file.",
  "Monthly GST summary is ready for review — please check before the filing deadline.",
];

function fillTemplate(template: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce((msg, [key, value]) => msg.split(`{${key}}`).join(value), template);
}

interface RowPlan {
  branchId: number | null;
  templateType: TemplateType;
  recipientPhone: string;
  message: string;
  payload: Prisma.InputJsonValue | undefined;
  relatedEntityType: string | null;
  relatedEntityId: number | null;
}

function planCustomerMarketingRow(customer: Customer, branchId: number): RowPlan {
  const message = fillTemplate(pickOne(CUSTOMER_MARKETING_MESSAGES), { name: customer.name });
  return {
    branchId,
    templateType: "CUSTOMER_MARKETING",
    recipientPhone: customer.phone,
    message,
    payload: undefined,
    relatedEntityType: "Customer",
    relatedEntityId: customer.id,
  };
}

function planVendorEbillRow(vendor: Vendor, branchId: number): RowPlan {
  const message = fillTemplate(pickOne(VENDOR_EBILL_MESSAGES), { name: vendor.name });
  return {
    branchId,
    templateType: "VENDOR_EBILL",
    recipientPhone: vendor.phone ?? "",
    message,
    payload: undefined,
    relatedEntityType: "Vendor",
    relatedEntityId: vendor.id,
  };
}

function planVendorPaymentRow(vendor: Vendor, branchId: number): RowPlan {
  const amount = randomInt(1000, 25000);
  const message = fillTemplate(pickOne(VENDOR_PAYMENT_MESSAGES), { name: vendor.name, amount: amount.toLocaleString("en-IN") });
  return {
    branchId,
    templateType: "VENDOR_PAYMENT",
    recipientPhone: vendor.phone ?? "",
    message,
    payload: { amount } as Prisma.InputJsonValue,
    relatedEntityType: "Vendor",
    relatedEntityId: vendor.id,
  };
}

function planGstUpdateRow(recipientPhone: string): RowPlan {
  return {
    branchId: null,
    templateType: "GST_UPDATE",
    recipientPhone,
    message: pickOne(GST_UPDATE_MESSAGES),
    payload: undefined,
    relatedEntityType: null,
    relatedEntityId: null,
  };
}

/**
 * Owns: WhatsAppMessageLog — a small, mostly-cosmetic log of outbound
 * WhatsApp notifications (customer marketing blasts, vendor e-bill/payment
 * nudges, and restaurant-wide GST reminders) spread across the seeded
 * history window. Not tied to any other generator's output beyond reading
 * ctx.customers/ctx.vendors for realistic recipients, so it can run any time
 * after the Foundation + Catalog + People phases have produced those.
 *
 * Idempotent: generates once per restaurant, checked via a plain count().
 */
export async function generateWhatsAppMessageLogs(
  db: Db,
  config: SeedConfig,
  ctx: SeedContext,
): Promise<WhatsAppMessageLog[]> {
  const existingCount = await db.whatsAppMessageLog.count({ where: { restaurantId: ctx.restaurant.id } });
  if (existingCount > 0) {
    return db.whatsAppMessageLog.findMany({ where: { restaurantId: ctx.restaurant.id } });
  }

  const days = historyDateRange(config.history.monthsOfHistory);
  const branchIds = ctx.branches.map((b) => b.branch.id);
  const totalRows = randomInt(TOTAL_ROWS_RANGE[0], TOTAL_ROWS_RANGE[1]);

  const rows: Prisma.WhatsAppMessageLogCreateManyInput[] = [];
  for (let i = 0; i < totalRows; i++) {
    const templateType = weightedPick(TEMPLATE_TYPE_MIX);
    const branchId = branchIds.length > 0 ? pickOne(branchIds) : null;

    let plan: RowPlan;
    if (templateType === "CUSTOMER_MARKETING") {
      if (ctx.customers.length === 0) continue;
      plan = planCustomerMarketingRow(pickOne(ctx.customers), branchId as number);
    } else if (templateType === "VENDOR_EBILL") {
      if (ctx.vendors.length === 0) continue;
      plan = planVendorEbillRow(pickOne(ctx.vendors), branchId as number);
    } else if (templateType === "VENDOR_PAYMENT") {
      if (ctx.vendors.length === 0) continue;
      plan = planVendorPaymentRow(pickOne(ctx.vendors), branchId as number);
    } else {
      plan = planGstUpdateRow(ctx.owner.phone ?? "9840012345");
    }

    if (!plan.recipientPhone) continue; // skip if the picked vendor has no phone on file

    const day = pickOne(days);
    rows.push({
      restaurantId: ctx.restaurant.id,
      branchId: plan.branchId,
      direction: "OUTBOUND",
      recipientPhone: plan.recipientPhone,
      templateType: plan.templateType,
      message: plan.message,
      payload: plan.payload,
      status: chance(0.92) ? "SENT" : "FAILED",
      relatedEntityType: plan.relatedEntityType,
      relatedEntityId: plan.relatedEntityId,
      createdById: ctx.owner.id,
      createdAt: randomTimeOnDay(day, 9, 21),
    });
  }

  return batchCreateManyAndReturn(rows, (chunk) => db.whatsAppMessageLog.createManyAndReturn({ data: chunk }));
}
