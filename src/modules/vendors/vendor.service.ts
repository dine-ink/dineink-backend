import prisma from "../../config/prisma";

// ── Vendor Payments ───────────────────────────────────────────────────────────

export const getVendorPaymentsService = async (vendorId: number) => {
  return prisma.vendorPayment.findMany({
    where: { vendorId },
    orderBy: { paymentDate: "desc" },
  });
};

export const createVendorPaymentService = async (data: {
  vendorId: number;
  restaurantId: number;
  branchId: number;
  amount: number;
  paymentMethod?: string;
  notes?: string;
  paymentDate: string;
  createdById?: number;
}) => {
  return prisma.vendorPayment.create({
    data: {
      vendorId:      data.vendorId,
      restaurantId:  data.restaurantId,
      branchId:      data.branchId,
      amount:        data.amount,
      paymentMethod: data.paymentMethod,
      notes:         data.notes,
      paymentDate:   new Date(data.paymentDate),
      createdById:   data.createdById,
    },
  });
};

export const deleteVendorPaymentService = async (id: number) => {
  return prisma.vendorPayment.delete({ where: { id } });
};

// ── Vendor Invoices ───────────────────────────────────────────────────────────

export const getVendorInvoicesService = async (vendorId: number) => {
  return prisma.vendorInvoice.findMany({
    where: { vendorId },
    orderBy: { invoiceDate: "desc" },
  });
};

export const createVendorInvoiceService = async (data: {
  vendorId: number;
  restaurantId: number;
  branchId: number;
  invoiceNumber?: string;
  invoiceDate: string;
  dueDate?: string;
  totalAmount: number;
  items?: any;
  notes?: string;
  createdById?: number;
}) => {
  return prisma.vendorInvoice.create({
    data: {
      vendorId:      data.vendorId,
      restaurantId:  data.restaurantId,
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
    },
  });
};

export const payVendorInvoiceService = async (
  invoiceId: number,
  payAmount: number,
) => {
  const invoice = await prisma.vendorInvoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new Error("Invoice not found");

  const newPaid = invoice.paidAmount + payAmount;
  const status  = newPaid >= invoice.totalAmount ? "PAID" : "PARTIAL";

  return prisma.vendorInvoice.update({
    where: { id: invoiceId },
    data:  { paidAmount: newPaid, status },
  });
};

export const deleteVendorInvoiceService = async (id: number) => {
  return prisma.vendorInvoice.delete({ where: { id } });
};

// ── Outstanding balances across all vendors ───────────────────────────────────

export const getVendorOutstandingService = async (
  restaurantId: number,
  branchId: number,
) => {
  const [vendors, invoices, payments] = await Promise.all([
    prisma.vendor.findMany({ where: { restaurantId, branchId } }),
    prisma.vendorInvoice.findMany({
      where: { restaurantId, branchId, status: { not: "PAID" } },
    }),
    prisma.vendorPayment.findMany({ where: { restaurantId, branchId } }),
  ]);

  return vendors.map((v) => {
    const vendorInvoices = invoices.filter((i) => i.vendorId === v.id);
    const vendorPayments = payments.filter((p) => p.vendorId === v.id);
    const totalBilled    = vendorInvoices.reduce((s, i) => s + i.totalAmount, 0);
    const totalPaid      = vendorPayments.reduce((s, p) => s + p.amount, 0);
    return {
      ...v,
      totalBilled,
      totalPaid,
      outstanding: Math.max(0, totalBilled - totalPaid),
      pendingInvoices: vendorInvoices.length,
    };
  });
};
