import { Router } from "express";
import { hasPermission, internalAuth, requirePermission } from "../rbac/internalAuth.middleware";
import { PERMISSIONS as P } from "../rbac/permissions";
import { AUDIT_ACTIONS, recordAudit } from "../audit/audit.service";
import { asyncHandler, badRequest } from "../shared/apiError";
import * as service from "./customers.service";

const router = Router();
router.use(internalAuth);

const customerId = (req: any) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("That isn't a valid customer id.", "INVALID_ID");
  return id;
};

router.get(
  "/",
  requirePermission(P.CUSTOMER_VIEW),
  asyncHandler(async (req, res) => {
    const data = await service.listCustomers(req.query as any, hasPermission(req, P.CUSTOMER_PII_VIEW));
    return res.json({ success: true, data });
  }),
);

router.get(
  "/:id",
  requirePermission(P.CUSTOMER_VIEW),
  asyncHandler(async (req, res) => {
    const canViewPii = hasPermission(req, P.CUSTOMER_PII_VIEW);
    const data = await service.getCustomer(customerId(req), canViewPii);
    if (canViewPii) {
      // Opening a customer's unmasked record is an access event in its own
      // right. Recording it is what makes "least privilege plus audit" mean
      // something rather than being a slogan.
      await recordAudit(req, {
        action: AUDIT_ACTIONS.CUSTOMER_PII_VIEWED,
        resourceType: "Customer",
        resourceId: customerId(req),
        resourceLabel: `CUST-${customerId(req)}`,
      });
    }
    return res.json({ success: true, data });
  }),
);

router.get(
  "/:id/orders",
  requirePermission(P.CUSTOMER_VIEW, P.ORDER_VIEW),
  asyncHandler(async (req, res) => {
    const data = await service.listCustomerOrders(customerId(req), req.query);
    return res.json({ success: true, data });
  }),
);

// Correlating one restaurant's customer record with another's is identity
// linking across tenants, so it needs the PII grant rather than plain
// CUSTOMER_VIEW.
router.get(
  "/:id/restaurants",
  requirePermission(P.CUSTOMER_VIEW, P.CUSTOMER_PII_VIEW),
  asyncHandler(async (req, res) => {
    const data = await service.listRestaurantsVisited(customerId(req));
    return res.json({ success: true, data });
  }),
);

router.get(
  "/:id/tickets",
  requirePermission(P.CUSTOMER_VIEW, P.TICKET_VIEW),
  asyncHandler(async (req, res) => {
    const data = await service.listCustomerTickets(customerId(req));
    return res.json({ success: true, data });
  }),
);

export default router;
