import prisma from "../../config/prisma";
import { ForbiddenError } from "./vendor.validation";
import { sendWhatsAppMessageService } from "../whatsapp/whatsapp.service";
import { sendReorderEmail } from "../../config/mailer";

// Whether this branch has ever logged a vendor invoice at all, regardless of
// payment status — distinguishes "no purchasing data entered" from "invoices
// exist and are all fully paid" (both look like outstanding = 0 otherwise).
export const getVendorInvoiceActivityService = async (
  restaurantId: number,
  branchId: number,
) => {
  const totalInvoiceCount = await prisma.vendorInvoice.count({
    where: { restaurantId, branchId },
  });
  return { totalInvoiceCount, hasAnyInvoices: totalInvoiceCount > 0 };
};

// ── Vendor Payments ───────────────────────────────────────────────────────────

// Capped rather than paginated — the UI shows a vendor's full history in one
// scrollable modal, not a paged grid, so a hard cap on the most recent rows
// protects against unbounded growth without needing frontend pagination.
const VENDOR_HISTORY_LIMIT = 500;

export const getVendorPaymentsService = async (vendorId: number) => {
  return prisma.vendorPayment.findMany({
    where: { vendorId },
    orderBy: { paymentDate: "desc" },
    take: VENDOR_HISTORY_LIMIT,
  });
};

export const createVendorPaymentService = async (callerRestaurantId: number, data: {
  vendorId: number;
  branchId: number;
  amount: number;
  paymentMethod?: string;
  notes?: string;
  paymentDate: string;
  createdById?: number;
}) => {
  const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId }, select: { restaurantId: true } });
  if (!vendor || vendor.restaurantId !== callerRestaurantId) throw new ForbiddenError("You do not have access to this vendor");
  return prisma.vendorPayment.create({
    data: {
      vendorId:      data.vendorId,
      restaurantId:  callerRestaurantId,
      branchId:      data.branchId,
      amount:        data.amount,
      paymentMethod: data.paymentMethod,
      notes:         data.notes,
      paymentDate:   new Date(data.paymentDate),
      createdById:   data.createdById,
    },
  });
};

export const deleteVendorPaymentService = async (callerRestaurantId: number, id: number) => {
  const existing = await prisma.vendorPayment.findUnique({ where: { id }, select: { restaurantId: true } });
  if (!existing) throw new Error("Payment not found");
  if (existing.restaurantId !== callerRestaurantId) throw new ForbiddenError("You do not have access to this payment");
  return prisma.vendorPayment.delete({ where: { id } });
};

// ── Vendor Invoices ───────────────────────────────────────────────────────────

export const getVendorInvoicesService = async (vendorId: number) => {
  return prisma.vendorInvoice.findMany({
    where: { vendorId },
    orderBy: { invoiceDate: "desc" },
    take: VENDOR_HISTORY_LIMIT,
  });
};

export const createVendorInvoiceService = async (callerRestaurantId: number, data: {
  vendorId: number;
  branchId: number;
  invoiceNumber?: string;
  invoiceDate: string;
  dueDate?: string;
  totalAmount: number;
  items?: any;
  notes?: string;
  createdById?: number;
  documentUrl?: string;
}) => {
  const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId }, select: { restaurantId: true } });
  if (!vendor || vendor.restaurantId !== callerRestaurantId) throw new ForbiddenError("You do not have access to this vendor");
  return prisma.vendorInvoice.create({
    data: {
      vendorId:      data.vendorId,
      restaurantId:  callerRestaurantId,
      branchId:      data.branchId,
      invoiceNumber: data.invoiceNumber,
      invoiceDate:   new Date(data.invoiceDate),
      dueDate:       data.dueDate ? new Date(data.dueDate) : null,
      totalAmount:   data.totalAmount,
      paidAmount:    0,
      status:        "UNPAID",
      items:         data.items,
      notes:         data.notes,
      createdById:   data.createdById,
      documentUrl:   data.documentUrl,
    },
  });
};

export const payVendorInvoiceService = async (
  callerRestaurantId: number,
  invoiceId: number,
  payAmount: number,
) => {
  const invoice = await prisma.vendorInvoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new Error("Invoice not found");
  if (invoice.restaurantId !== callerRestaurantId) throw new ForbiddenError("You do not have access to this invoice");

  const newPaid = invoice.paidAmount + payAmount;
  const status  = newPaid >= invoice.totalAmount ? "PAID" : "PARTIAL";

  return prisma.vendorInvoice.update({
    where: { id: invoiceId },
    data:  { paidAmount: newPaid, status },
  });
};

export const deleteVendorInvoiceService = async (callerRestaurantId: number, id: number) => {
  const existing = await prisma.vendorInvoice.findUnique({ where: { id }, select: { restaurantId: true } });
  if (!existing) throw new Error("Invoice not found");
  if (existing.restaurantId !== callerRestaurantId) throw new ForbiddenError("You do not have access to this invoice");
  return prisma.vendorInvoice.delete({ where: { id } });
};

// ── Outstanding balances across all vendors ───────────────────────────────────

export const getVendorOutstandingService = async (
  restaurantId: number,
  branchId: number,
) => {
  const [vendors, invoices, payments] = await Promise.all([
    prisma.vendor.findMany({ where: { restaurantId, branchId } }),
    // Naturally self-limiting — only currently-unpaid invoices, not full history.
    prisma.vendorInvoice.findMany({
      where: { restaurantId, branchId, status: { not: "PAID" } },
    }),
    // Unlike the invoice fetch above, this has no natural bound (every
    // payment ever recorded stays PAID forever) — capped for the same reason
    // as getVendorPaymentsService.
    prisma.vendorPayment.findMany({
      where: { restaurantId, branchId },
      orderBy: { paymentDate: "desc" },
      take: VENDOR_HISTORY_LIMIT,
    }),
  ]);

  return vendors.map((v) => {
    const vendorInvoices = invoices.filter((i) => i.vendorId === v.id);
    const vendorPayments = payments.filter((p) => p.vendorId === v.id);
    const totalBilled = vendorInvoices.reduce((s, i) => s + i.totalAmount, 0);
    // Outstanding must reflect paidAmount already recorded against each
    // invoice (maintained by payVendorInvoiceService) — VendorPayment is a
    // separate, invoice-unlinked ledger, so summing it instead ignored any
    // partial payment made via the "pay invoice" flow entirely.
    const totalPaid = vendorInvoices.reduce((s, i) => s + i.paidAmount, 0);
    const totalRecordedPayments = vendorPayments.reduce((s, p) => s + p.amount, 0);
    return {
      ...v,
      totalBilled,
      totalPaid,
      totalRecordedPayments,
      outstanding: Math.max(0, totalBilled - totalPaid),
      pendingInvoices: vendorInvoices.length,
    };
  });
};

// ── Vendor Performance (purchase volume, payment status, price trend) ────────
//
// The schema has no delivery-quality or on-time-delivery signal for vendors —
// invoices only carry amounts/dates. So this reports what's actually
// knowable: how much you buy from each vendor, what you still owe them (and
// how much of that is overdue), and whether the ingredients they supply have
// been getting more or less expensive over time (via IngredientPriceHistory,
// linked through IngredientVendor since price history itself isn't
// vendor-tagged — this is a "price trend for what this vendor supplies", not
// a per-transaction vendor price, which the schema can't distinguish).

export const getVendorPerformanceService = async (
  restaurantId: number,
  branchId: number,
  from?: string,
  to?: string,
) => {
  const dateFilter =
    from && to
      ? { invoiceDate: { gte: new Date(from), lte: new Date(to + "T23:59:59.999Z") } }
      : {};

  const [vendors, invoices, ingredientLinks] = await Promise.all([
    prisma.vendor.findMany({ where: { restaurantId, branchId } }),
    prisma.vendorInvoice.findMany({
      where: { restaurantId, branchId, ...dateFilter },
      // Matches the same VENDOR_HISTORY_LIMIT bound already applied to this
      // file's other three vendor-history queries — this one was added later
      // for the Vendor Performance feature and had no cap, so a branch with
      // no from/to filter (the frontend never supplies one) could pull its
      // entire invoice history with no bound.
      orderBy: { invoiceDate: "desc" },
      take: VENDOR_HISTORY_LIMIT,
    }),
    prisma.ingredientVendor.findMany({
      where: { branchId },
      select: {
        vendorId: true,
        ingredient: {
          select: {
            id: true,
            name: true,
            priceHistory: {
              orderBy: { createdAt: "asc" },
              select: { oldPrice: true, newPrice: true, createdAt: true },
            },
          },
        },
      },
    }),
  ]);

  const now = new Date();

  return vendors.map((v) => {
    const vendorInvoices = invoices.filter((i) => i.vendorId === v.id);
    const totalPurchaseValue = vendorInvoices.reduce((s, i) => s + i.totalAmount, 0);
    const totalOutstanding = vendorInvoices.reduce(
      (s, i) => s + Math.max(0, i.totalAmount - i.paidAmount),
      0,
    );
    const overdueInvoices = vendorInvoices.filter(
      (i) => i.status !== "PAID" && i.dueDate && i.dueDate < now,
    );
    const overdueAmount = overdueInvoices.reduce(
      (s, i) => s + Math.max(0, i.totalAmount - i.paidAmount),
      0,
    );
    const lastInvoiceDate = vendorInvoices.length
      ? vendorInvoices.reduce(
          (latest, i) => (i.invoiceDate > latest ? i.invoiceDate : latest),
          vendorInvoices[0].invoiceDate,
        )
      : null;

    const suppliedIngredients = ingredientLinks
      .filter((l) => l.vendorId === v.id)
      .map((l) => l.ingredient);

    const pctChanges: number[] = [];
    suppliedIngredients.forEach((ing) => {
      const history = ing.priceHistory;
      if (!history.length) return;
      const first = history[0].oldPrice ?? history[0].newPrice;
      const last = history[history.length - 1].newPrice;
      if (!first) return;
      pctChanges.push(((last - first) / first) * 100);
    });
    const avgPriceChangePct = pctChanges.length
      ? Math.round((pctChanges.reduce((s, p) => s + p, 0) / pctChanges.length) * 10) / 10
      : null;

    return {
      id: v.id,
      name: v.name,
      phone: v.phone,
      totalPurchaseValue,
      invoiceCount: vendorInvoices.length,
      totalOutstanding,
      overdueAmount,
      overdueInvoiceCount: overdueInvoices.length,
      lastInvoiceDate,
      suppliedIngredientCount: suppliedIngredients.length,
      avgPriceChangePct,
      priceTrend:
        avgPriceChangePct == null
          ? "NO_DATA"
          : avgPriceChangePct > 2
            ? "RISING"
            : avgPriceChangePct < -2
              ? "FALLING"
              : "STABLE",
    };
  });
};

// ── Vendor Pricing History ───────────────────────────────────────────────────
//
// Same IngredientVendor join used by getVendorPerformanceService above —
// price history isn't itself vendor-tagged, so "pricing history for this
// vendor" means the price history of whatever ingredients this vendor is
// linked to supply, read from the existing IngredientPriceHistory rows
// rather than a new price-tracking mechanism.

export const getVendorPricingHistoryService = async (restaurantId: number, vendorId: number) => {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { restaurantId: true } });
  if (!vendor || vendor.restaurantId !== restaurantId) {
    throw new ForbiddenError("You do not have access to this vendor");
  }

  const ingredientLinks = await prisma.ingredientVendor.findMany({
    where: { vendorId },
    select: {
      ingredient: {
        select: {
          id: true,
          name: true,
          pricePerUnit: true,
          priceHistory: {
            orderBy: { createdAt: "asc" },
            select: { oldPrice: true, newPrice: true, createdAt: true },
          },
        },
      },
    },
  });

  return ingredientLinks.map((l) => {
    const ing = l.ingredient;
    const priceHistory = ing.priceHistory.map((h) => ({
      oldPrice:  h.oldPrice,
      newPrice:  h.newPrice,
      changedAt: h.createdAt,
    }));

    const currentPrice = ing.pricePerUnit ?? null;
    // previousPrice comes from the oldPrice of the most recent change — but
    // only once there's more than one recorded change; with a single entry
    // there's no earlier *recorded* trend to compare against yet.
    const mostRecent = priceHistory.length > 1 ? priceHistory[priceHistory.length - 1] : null;
    const previousPrice = mostRecent ? mostRecent.oldPrice ?? null : null;
    const changePercent =
      previousPrice != null && currentPrice != null && previousPrice !== 0
        ? Math.round(((currentPrice - previousPrice) / previousPrice) * 1000) / 10
        : null;

    return {
      ingredientId:   ing.id,
      ingredientName: ing.name,
      currentPrice,
      previousPrice,
      changePercent,
      priceHistory,
    };
  });
};

// ── Vendor Reorder (WhatsApp / Email) ────────────────────────────────────────
//
// Composes a plain human-readable reorder message from the named ingredients
// and sends it via whichever channel the caller picked. WhatsApp delivery
// goes through the shared sendWhatsAppMessageService (the one place any
// module should send a WhatsApp message) so the attempt is logged the same
// way every other WhatsApp-sending feature's attempts are. Email delivery
// uses the small sendReorderEmail helper added to config/mailer.ts for this
// feature.

export const reorderVendorService = async (
  callerRestaurantId: number,
  data: {
    vendorId: number;
    branchId?: number;
    channel: "whatsapp" | "email";
    ingredientIds: number[];
    createdById?: number;
  },
) => {
  const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId } });
  if (!vendor || vendor.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this vendor");
  }

  const ingredients = await prisma.ingredient.findMany({
    where: { id: { in: data.ingredientIds ?? [] }, restaurantId: callerRestaurantId },
    select: { id: true, name: true, reorderLevel: true, quantity: true, unit: true },
  });

  const ingredientList = ingredients
    .map((i) => {
      const qty = i.reorderLevel ?? i.quantity;
      return qty != null ? `${i.name} (${qty}${i.unit ? " " + i.unit : ""})` : i.name;
    })
    .join(", ");

  const message = `Reorder request for ${vendor.name}: ${ingredientList || "(no items specified)"}`;

  if (data.channel === "whatsapp") {
    // A plain Error (not ForbiddenError) — the vendor is accessible, it's
    // just missing the contact detail this channel needs. The controller
    // maps this to 400, not 403/500.
    if (!vendor.phone) throw new Error("Vendor has no phone number on file");
    await sendWhatsAppMessageService(callerRestaurantId, {
      branchId:          data.branchId ?? null,
      recipientPhone:    vendor.phone,
      templateType:      "VENDOR_EBILL",
      message,
      relatedEntityType: "Vendor",
      relatedEntityId:   data.vendorId,
      createdById:       data.createdById,
    });
  } else if (data.channel === "email") {
    if (!vendor.email) throw new Error("Vendor has no email on file");
    await sendReorderEmail(vendor.email, `Reorder request - ${vendor.name}`, message);
  } else {
    throw new Error("Invalid reorder channel");
  }

  return { success: true, channel: data.channel };
};
