// Indian financial year runs Apr 1 – Mar 31. Returns the FY's starting
// calendar year, e.g. "2026" for any date in FY 2026-27 (Apr 2026–Mar 2027).
const getFinancialYear = (date: Date = new Date()): string => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1-12
  return String(month >= 4 ? year : year - 1);
};

// Must be called inside the same transaction that creates the Bill row —
// the upsert+increment is atomic per (branchId, financialYear), so
// concurrent bill creations on the same branch can never collide or skip a
// number, satisfying GST's sequential/gapless invoice numbering requirement.
export const generateBillNo = async (
  tx: any,
  restaurantId: number,
  branchId: number,
): Promise<string> => {
  const financialYear = getFinancialYear();
  const seq = await tx.invoiceSequence.upsert({
    where: { branchId_financialYear: { branchId, financialYear } },
    create: { restaurantId, branchId, financialYear, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  // branchId is embedded in the number itself, not just tracked in
  // InvoiceSequence — without it, two branches both issuing their "bill #1"
  // in the same financial year produce the identical string, which then
  // collides against Bill.billNo's *global* unique constraint the moment a
  // restaurant has more than one branch.
  return `INV-${financialYear}-B${branchId}-${String(seq.lastNumber).padStart(6, "0")}`;
};
