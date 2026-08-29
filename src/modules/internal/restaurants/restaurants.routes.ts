import { Router } from "express";
import { internalAuth, requirePermission } from "../rbac/internalAuth.middleware";
import { PERMISSIONS as P } from "../rbac/permissions";
import * as c from "./restaurants.controller";

/**
 * Every route carries its own permission. There is no "logged in is enough"
 * route in this module — the sidebar hides what an employee can't reach, but
 * these checks are what actually decides.
 */
const router = Router();

router.use(internalAuth);

// List & detail
router.get("/", requirePermission(P.RESTAURANT_VIEW), c.list);
router.get("/filter-options", requirePermission(P.RESTAURANT_VIEW), c.filterOptions);
router.post("/", requirePermission(P.RESTAURANT_CREATE), c.create);
router.get("/:id", requirePermission(P.RESTAURANT_VIEW), c.detail);
router.patch("/:id", requirePermission(P.RESTAURANT_EDIT), c.update);
router.get("/:id/activity", requirePermission(P.RESTAURANT_VIEW), c.activity);

// Statutory / financial information is a separate grant, on its own endpoint.
router.get("/:id/financial", requirePermission(P.RESTAURANT_FINANCIAL_VIEW), c.financialProfile);

// Lifecycle
router.post("/:id/activate", requirePermission(P.RESTAURANT_ACTIVATE), c.activate);
router.post("/:id/suspend", requirePermission(P.RESTAURANT_SUSPEND), c.suspend);

// Onboarding
router.get("/:id/onboarding", requirePermission(P.RESTAURANT_VIEW), c.getOnboarding);
router.patch("/:id/onboarding/tasks/:taskKey", requirePermission(P.RESTAURANT_ONBOARDING_MANAGE), c.updateOnboardingTask);
router.post("/:id/onboarding/stage", requirePermission(P.RESTAURANT_ONBOARDING_MANAGE), c.setOnboardingStage);

// Restaurant users
router.get("/:id/users", requirePermission(P.RESTAURANT_USER_VIEW), c.listUsers);
router.post("/:id/users", requirePermission(P.RESTAURANT_USER_MANAGE), c.createUser);
router.patch("/:id/users/:userId", requirePermission(P.RESTAURANT_USER_MANAGE), c.updateUser);
router.post("/:id/users/:userId/status", requirePermission(P.RESTAURANT_USER_MANAGE), c.setUserActive);
router.post("/:id/users/:userId/reset-access", requirePermission(P.RESTAURANT_USER_MANAGE), c.resetUserAccess);

// Menu — viewing and editing are separate grants on purpose.
router.get("/:id/menu", requirePermission(P.RESTAURANT_MENU_VIEW), c.getMenu);
router.patch("/:id/menu/items/:itemId", requirePermission(P.RESTAURANT_MENU_EDIT), c.updateMenuItem);

// Tables & QR
router.get("/:id/tables", requirePermission(P.RESTAURANT_TABLE_VIEW), c.listTables);
router.get("/:id/tables/:tableId/qr", requirePermission(P.RESTAURANT_TABLE_VIEW), c.qrImage);
router.post("/:id/tables/:tableId/qr", requirePermission(P.RESTAURANT_TABLE_MANAGE), c.generateQr);
router.post("/:id/tables/:tableId/qr/regenerate", requirePermission(P.RESTAURANT_TABLE_MANAGE), c.regenerateQr);
router.post("/:id/tables/:tableId/qr/status", requirePermission(P.RESTAURANT_TABLE_MANAGE), c.setQrEnabled);

// Related records — each gated by the permission for that record type, not by
// RESTAURANT_VIEW. Reaching an order through a restaurant page must not be a
// way around not being allowed to see orders.
router.get("/:id/orders", requirePermission(P.ORDER_VIEW), c.restaurantOrders);
router.get("/:id/orders/live", requirePermission(P.ORDER_VIEW), c.restaurantLiveOrders);
router.get("/:id/transactions", requirePermission(P.TRANSACTION_VIEW), c.restaurantTransactions);
router.get("/:id/customers", requirePermission(P.CUSTOMER_VIEW), c.restaurantCustomers);

export default router;
