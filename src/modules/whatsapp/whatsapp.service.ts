import prisma from "../../config/prisma";
import { whatsAppSender } from "../../config/whatsapp";

export type WhatsAppTemplateType =
  | "CUSTOMER_MARKETING"
  | "VENDOR_EBILL"
  | "VENDOR_PAYMENT"
  | "GST_UPDATE";

// ── Send + log a WhatsApp message ───────────────────────────────────────────
//
// This is the ONE place in the codebase any module should call to send a
// WhatsApp message — Vendor Intelligence's reorder feature, Compliance
// Checker's GST reminders, general customer marketing messages, etc. It
// sends via the swappable `whatsAppSender` (config/whatsapp.ts, mocked
// today) and always records the attempt — success or failure — as a
// WhatsAppMessageLog row scoped to the caller's own restaurant, so the log
// is a complete audit trail regardless of which provider is behind the
// sender at the time.
//
// Public API for cross-module reuse: import `sendWhatsAppMessageService`
// from this file.
export const sendWhatsAppMessageService = async (
  callerRestaurantId: number,
  data: {
    branchId?: number | null;
    recipientPhone: string;
    templateType: WhatsAppTemplateType;
    message: string;
    payload?: any;
    relatedEntityType?: string;
    relatedEntityId?: number;
    createdById?: number;
  },
) => {
  const result = await whatsAppSender.send({
    toPhone: data.recipientPhone,
    message: data.message,
    templateType: data.templateType,
    payload: data.payload,
  });

  return prisma.whatsAppMessageLog.create({
    data: {
      restaurantId:      callerRestaurantId,
      branchId:          data.branchId ?? null,
      recipientPhone:    data.recipientPhone,
      templateType:      data.templateType,
      message:           data.message,
      payload:           data.payload,
      status:            result.status,
      relatedEntityType: data.relatedEntityType,
      relatedEntityId:   data.relatedEntityId,
      createdById:       data.createdById,
    },
  });
};

// ── Message log listing ──────────────────────────────────────────────────────

export const getWhatsAppLogsService = async (
  restaurantId: number,
  branchId?: number,
  limit: number = 200,
) => {
  return prisma.whatsAppMessageLog.findMany({
    where: {
      restaurantId,
      // branchId omitted entirely means "all branches"; a branchId of null
      // in the schema means "restaurant-wide" — these are different filters,
      // so only add the clause when the caller actually asked for one branch.
      ...(branchId !== undefined ? { branchId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
};
