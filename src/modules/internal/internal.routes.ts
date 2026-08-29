import { Router } from "express";
import analyticsRoutes from "./analytics/analytics.routes";
import auditRoutes from "./audit/audit.routes";
import authRoutes from "./auth/internalAuth.routes";
import customerRoutes from "./customers/customers.routes";
import dashboardRoutes from "./dashboard/dashboard.routes";
import employeeRoutes from "./employees/employees.routes";
import orderRoutes from "./orders/orders.routes";
import restaurantRoutes from "./restaurants/restaurants.routes";
import roleRoutes from "./roles/roles.routes";
import settingsRoutes from "./settings/settings.routes";
import ticketRoutes from "./tickets/tickets.routes";
import transactionRoutes from "./transactions/transactions.routes";
import { internalErrorHandler } from "./shared/apiError";

/**
 * Everything the DineInk internal application talks to, mounted at
 * /api/internal.
 *
 * This is a separate surface from the restaurant APIs by design. The restaurant
 * routes are written for a caller who owns exactly one restaurant and are
 * guarded accordingly (`requireOwnRestaurant`/`requireOwnBranch`); exposing them
 * to employees would mean loosening those guards for everybody. Instead the
 * routes below re-enter the same shared services with an explicitly authorized
 * restaurantId, so the business logic stays in one place while the
 * authorization model for each audience stays its own.
 */
const router = Router();

router.use("/auth", authRoutes);

// Workspace
router.use("/restaurants", restaurantRoutes);
router.use("/customers", customerRoutes);
router.use("/orders", orderRoutes);
router.use("/transactions", transactionRoutes);

// Operations
router.use("/tickets", ticketRoutes);

// Administration
router.use("/employees", employeeRoutes);
router.use("/roles", roleRoutes);
router.use("/audit-logs", auditRoutes);
router.use("/settings", settingsRoutes);

// Analytics, reports, system health and application logs.
router.use("/", analyticsRoutes);

// Dashboard, global search and the engineering queue live at the top level.
router.use("/", dashboardRoutes);

// Registered last so every ApiError thrown anywhere above is turned into the
// internal app's error shape rather than falling through to the global handler,
// which returns raw `err.message`.
router.use(internalErrorHandler);

export default router;
