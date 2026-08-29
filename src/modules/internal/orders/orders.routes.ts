import { Router } from "express";
import { hasPermission, internalAuth, requirePermission } from "../rbac/internalAuth.middleware";
import { PERMISSIONS as P } from "../rbac/permissions";
import { asyncHandler, badRequest } from "../shared/apiError";
import * as service from "./orders.service";

const router = Router();
router.use(internalAuth);

router.get(
  "/",
  requirePermission(P.ORDER_VIEW),
  asyncHandler(async (req, res) => {
    const data = await service.listOrders(req.query as any, hasPermission(req, P.CUSTOMER_PII_VIEW));
    return res.json({ success: true, data });
  }),
);

/** The status vocabularies, so the filter menus reflect what the data can be. */
router.get(
  "/meta",
  requirePermission(P.ORDER_VIEW),
  asyncHandler(async (_req, res) =>
    res.json({
      success: true,
      data: {
        orderStatuses: service.BILL_ORDER_STATUSES,
        paymentStatuses: service.BILL_PAYMENT_STATUSES,
        kitchenStatuses: service.KITCHEN_STATUSES,
        writesEnabled: service.ORDER_WRITES_ENABLED,
      },
    }),
  ),
);

router.get(
  "/:id",
  requirePermission(P.ORDER_VIEW),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest("That isn't a valid order id.", "INVALID_ID");
    const data = await service.getOrder(id, hasPermission(req, P.CUSTOMER_PII_VIEW));
    return res.json({ success: true, data });
  }),
);

export default router;
