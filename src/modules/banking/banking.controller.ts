import { Response } from "express";
import {
  getBankAccountsService,
  createBankAccountService,
  updateBankAccountService,
  deleteBankAccountService,
  getUpiConfigService,
  upsertUpiConfigService,
  generateUpiQrService,
  getBankTransactionsService,
  createBankTransactionService,
  updateBankTransactionService,
  deleteBankTransactionService,
  reconcileTransactionsService,
} from "./banking.service";
import { ForbiddenError } from "./banking.validation";

const handleError = (error: any, res: Response, message: string) => {
  console.log(error);
  if (error instanceof ForbiddenError) {
    return res.status(403).json({ success: false, message: error.message });
  }
  // Plain "not found" / "not configured" errors thrown by the service are
  // client errors (bad id, missing UPI config), not server failures — the
  // service never throws generic Errors for anything else, so matching on
  // message text here is safe and mirrors how other modules (e.g. dues,
  // vendors) distinguish a 404/400 from a genuine 500.
  if (
    error instanceof Error &&
    (error.message.includes("not found") || error.message.includes("No UPI ID configured"))
  ) {
    return res.status(400).json({ success: false, message: error.message });
  }
  return res.status(500).json({ success: false, message: error.message || message });
};

// ── Bank Accounts ─────────────────────────────────────────────────────────────

export const getBankAccounts = async (req: any, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = req.query.branchId !== undefined ? Number(req.query.branchId) : undefined;
    const data = await getBankAccountsService(restaurantId, branchId);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to fetch bank accounts");
  }
};

export const createBankAccount = async (req: any, res: Response) => {
  try {
    const data = await createBankAccountService(Number(req.user.restaurantId), req.body);
    return res.status(201).json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to create bank account");
  }
};

export const updateBankAccount = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    const data = await updateBankAccountService(Number(req.user.restaurantId), id, req.body);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to update bank account");
  }
};

export const deleteBankAccount = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    await deleteBankAccountService(Number(req.user.restaurantId), id);
    return res.json({ success: true });
  } catch (err: any) {
    return handleError(err, res, "Failed to delete bank account");
  }
};

// ── UPI Config ────────────────────────────────────────────────────────────────

export const getUpiConfig = async (req: any, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const data = await getUpiConfigService(restaurantId, branchId);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to fetch UPI config");
  }
};

export const upsertUpiConfig = async (req: any, res: Response) => {
  try {
    const data = await upsertUpiConfigService(Number(req.user.restaurantId), req.body);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to save UPI config");
  }
};

export const generateUpiQr = async (req: any, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const data = await generateUpiQrService(restaurantId, branchId);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to generate UPI QR code");
  }
};

// ── Bank Transactions ─────────────────────────────────────────────────────────

export const getBankTransactions = async (req: any, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = Number(req.params.branchId);
    const { from, to } = req.query;
    const data = await getBankTransactionsService(restaurantId, branchId, from, to);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to fetch bank transactions");
  }
};

export const createBankTransaction = async (req: any, res: Response) => {
  try {
    const data = await createBankTransactionService(Number(req.user.restaurantId), {
      ...req.body,
      createdById: req.user.id,
    });
    return res.status(201).json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to create bank transaction entry");
  }
};

export const updateBankTransaction = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    const data = await updateBankTransactionService(Number(req.user.restaurantId), id, req.body);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to update bank transaction entry");
  }
};

export const deleteBankTransaction = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    await deleteBankTransactionService(Number(req.user.restaurantId), id);
    return res.json({ success: true });
  } catch (err: any) {
    return handleError(err, res, "Failed to delete bank transaction entry");
  }
};

export const reconcileTransactions = async (req: any, res: Response) => {
  try {
    const branchId = Number(req.params.branchId);
    const data = await reconcileTransactionsService(Number(req.user.restaurantId), branchId);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to reconcile bank transactions");
  }
};
