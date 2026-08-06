import express from "express";
import {
  getBankAccounts,
  createBankAccount,
  updateBankAccount,
  deleteBankAccount,
  getUpiConfig,
  upsertUpiConfig,
  generateUpiQr,
  getBankTransactions,
  createBankTransaction,
  updateBankTransaction,
  deleteBankTransaction,
  reconcileTransactions,
} from "./banking.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnRestaurant, requireOwnBranch, requireRole } from "../../middleware/authorize";

const router = express.Router();

// Bank details, UPI IDs, and manually-reconciled bank transactions are all
// financially sensitive, so — same project decision already applied to the
// EMI module — this is gated to OWNER/MANAGER on top of the usual auth +
// tenant-ownership checks.
router.use(authMiddleware, requireRole("OWNER", "MANAGER"));

// ── Bank Accounts ─────────────────────────────────────────────────────────────
router.get("/accounts/:restaurantId", requireOwnRestaurant(), getBankAccounts);
router.post("/accounts", createBankAccount);
router.put("/accounts/:id", updateBankAccount);
router.delete("/accounts/:id", deleteBankAccount);

// ── UPI Config / QR ───────────────────────────────────────────────────────────
router.get("/upi/:restaurantId/:branchId", requireOwnRestaurant(), requireOwnBranch(), getUpiConfig);
router.put("/upi", upsertUpiConfig);
router.get("/upi/:restaurantId/:branchId/qr", requireOwnRestaurant(), requireOwnBranch(), generateUpiQr);

// ── Bank Transactions / Reconciliation ────────────────────────────────────────
router.get(
  "/transactions/:restaurantId/:branchId",
  requireOwnRestaurant(),
  requireOwnBranch(),
  getBankTransactions,
);
router.post("/transactions", createBankTransaction);
router.put("/transactions/:id", updateBankTransaction);
router.delete("/transactions/:id", deleteBankTransaction);
router.post(
  "/transactions/:restaurantId/:branchId/reconcile",
  requireOwnRestaurant(),
  requireOwnBranch(),
  reconcileTransactions,
);

export default router;
