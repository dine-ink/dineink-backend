import prisma from "../../config/prisma";
import { whatsAppSender } from "../../config/whatsapp";
import { ForbiddenError, MAX_WHATSAPP_TEMPLATES, ValidationError } from "./whatsapp.validation";

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

// ── Templates — reusable bulk-marketing message bodies, capped at 5 per
// restaurant (enforced here, not in the schema — see WhatsAppTemplate's own
// doc comment in schema.prisma for why that matches every other "at most N"
// rule in this codebase). ──────────────────────────────────────────────────

export const createWhatsAppTemplateService = async (
  restaurantId: number,
  data: { name: string; message: string },
  createdById?: number,
) => {
  const existingCount = await prisma.whatsAppTemplate.count({ where: { restaurantId } });
  if (existingCount >= MAX_WHATSAPP_TEMPLATES) {
    throw new ValidationError(`You already have ${MAX_WHATSAPP_TEMPLATES} templates — delete one before adding another.`);
  }
  return prisma.whatsAppTemplate.create({
    data: { restaurantId, name: data.name, message: data.message, createdById },
  });
};

export const listWhatsAppTemplatesService = async (restaurantId: number) => {
  return prisma.whatsAppTemplate.findMany({
    where: { restaurantId },
    orderBy: { createdAt: "asc" },
  });
};

const findOwnedTemplate = async (restaurantId: number, templateId: number) => {
  const template = await prisma.whatsAppTemplate.findUnique({ where: { id: templateId } });
  if (!template || template.restaurantId !== restaurantId) throw new ForbiddenError("Template not found");
  return template;
};

export const deleteWhatsAppTemplateService = async (restaurantId: number, templateId: number) => {
  await findOwnedTemplate(restaurantId, templateId);
  await prisma.whatsAppTemplate.delete({ where: { id: templateId } });
};

export const updateWhatsAppTemplateService = async (
  restaurantId: number,
  templateId: number,
  data: { name?: string; message?: string },
) => {
  await findOwnedTemplate(restaurantId, templateId);
  return prisma.whatsAppTemplate.update({ where: { id: templateId }, data });
};

// ── Bulk send ────────────────────────────────────────────────────────────

/** Replaces every {{name}} (case-insensitive, tolerant of inner whitespace) with the recipient's real name. */
export const personalizeWhatsAppMessage = (message: string, customerName: string): string =>
  message.replace(/\{\{\s*name\s*\}\}/gi, customerName);

/**
 * Sends one WhatsApp message per selected customer, each personalized from
 * the same template, reusing sendWhatsAppMessageService per-recipient (the
 * one place any module sends+logs a WhatsApp message) rather than a second
 * send/log mechanism. A per-recipient failure (e.g. a downstream sender
 * error) doesn't abort the rest of the batch — it's just counted as failed,
 * same as any other WhatsAppMessageLog row with status FAILED.
 */
export const sendBulkWhatsAppMessageService = async (
  restaurantId: number,
  data: { templateId: number; customerIds: number[]; branchId?: number | null },
  createdById?: number,
) => {
  const template = await findOwnedTemplate(restaurantId, data.templateId);

  const customers = await prisma.customer.findMany({
    where: { restaurantId, id: { in: data.customerIds } },
    select: { id: true, name: true, phone: true },
  });

  const results = await Promise.all(
    customers.map(async (customer) => {
      try {
        const log = await sendWhatsAppMessageService(restaurantId, {
          branchId: data.branchId ?? null,
          recipientPhone: customer.phone,
          templateType: "CUSTOMER_MARKETING",
          message: personalizeWhatsAppMessage(template.message, customer.name),
          relatedEntityType: "CUSTOMER",
          relatedEntityId: customer.id,
          createdById,
        });
        return log.status as "SENT" | "FAILED";
      } catch {
        return "FAILED" as const;
      }
    }),
  );

  return {
    total: results.length,
    sent: results.filter((r) => r === "SENT").length,
    failed: results.filter((r) => r === "FAILED").length,
  };
};
