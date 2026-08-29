import { Router } from "express";
import { hasPermission, internalAuth, requirePermission } from "../rbac/internalAuth.middleware";
import { PERMISSIONS as P } from "../rbac/permissions";
import { asyncHandler, badRequest } from "../shared/apiError";
import * as service from "./transactions.service";
import { isJiraConfigured } from "../jira/jira.client";

const router = Router();
router.use(internalAuth);

router.get(
  "/",
  requirePermission(P.TRANSACTION_VIEW),
  asyncHandler(async (req, res) => {
    const data = await service.listTransactions(req.query as any, hasPermission(req, P.CUSTOMER_PII_VIEW));
    return res.json({ success: true, data });
  }),
);

router.get(
  "/meta",
  requirePermission(P.TRANSACTION_VIEW),
  asyncHandler(async (_req, res) => {
    const paymentMethods = await service.getPaymentMethods();
    return res.json({
      success: true,
      data: {
        paymentMethods,
        statuses: [
          "INITIATED",
          "PROCESSING",
          "SUCCESS",
          "CANCELLED",
          "PARTIALLY_REFUNDED",
          "REFUNDED",
        ],
        // Tells the UI to render gateway columns as "not integrated" rather
        // than as empty values that look like missing data.
        gatewayIntegrated: false,
        jiraConfigured: isJiraConfigured(),
      },
    });
  }),
);

router.get(
  "/:id",
  requirePermission(P.TRANSACTION_VIEW),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest("That isn't a valid transaction id.", "INVALID_ID");
    const data = await service.getTransaction(id, hasPermission(req, P.CUSTOMER_PII_VIEW));
    return res.json({ success: true, data });
  }),
);

export default router;
