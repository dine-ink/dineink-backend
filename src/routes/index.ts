import express from "express";
import authRoutes from "../modules/auth/auth.routes";
import analyticsRoutes from "../modules/analytics/analytics.routes";
import billRoutes from "../modules/bills/bill.routes";
import customerRoutes from "../modules/customers/customer.routes";
import ingredientRoutes from "../modules/ingredients/ingredient.routes";
import inventoryRoutes from "../modules/inventory/inventory.routes";
import restaurantRoutes from "../modules/restaurant/restaurant.routes";
import runningOrderRoutes from "../modules/runningOrders/runningOrder.routes";
import settingsRoutes from "../modules/settings/settings.routes";
import adminRoutes from "../modules/admin/admin.routes";
import reportsRoutes from "../modules/reports/reports.routes";
import cashRoutes from "../modules/cash/cash.routes";
import attendanceRoutes from "../modules/attendance/attendance.routes";
import ordersRoutes from "../modules/orders/orders.routes";
import vendorRoutes from "../modules/vendors/vendor.routes";
import sopRoutes from "../modules/sop/sop.routes";
import addonRoutes from "../modules/addons/addon.routes";
import discountRoutes from "../modules/discounts/discount.routes";
import procurementRoutes from "../modules/procurement/procurement.routes";
import financeRoutes from "../modules/finance/finance.routes";
import financeAssumptionsRoutes from "../modules/financeAssumptions/financeAssumptions.routes";
import budgetRoutes from "../modules/budget/budget.routes";
import scenarioRoutes from "../modules/scenario/scenario.routes";
import forecastRoutes from "../modules/forecast/forecast.routes";
import investmentRoutes from "../modules/investment/investment.routes";
import executiveRoutes from "../modules/executive/executive.routes";
import aiRoutes from "../modules/ai/ai.routes";
import duesRoutes from "../modules/dues/dues.routes";
import emiRoutes from "../modules/emi/emi.routes";
import equipmentRoutes from "../modules/equipment/equipment.routes";
import laborRoutes from "../modules/labor/labor.routes";
import complianceRoutes from "../modules/compliance/compliance.routes";
import whatsappRoutes from "../modules/whatsapp/whatsapp.routes";
import cashflowRoutes from "../modules/cashflow/cashflow.routes";
import bankingRoutes from "../modules/banking/banking.routes";
import internalRoutes from "../modules/internal/internal.routes";
import { guardIdParams } from "../middleware/routeParams";

const router = express.Router();

/**
 * The API surface, as data.
 *
 * Written as a table rather than 36 `router.use(...)` calls so that anything
 * which must be true of *every* module — today the id-parameter guard, tomorrow
 * whatever else — is applied by construction instead of by each author
 * remembering. Adding a module here is one row, and it cannot silently opt out.
 */
const MODULES: ReadonlyArray<readonly [path: string, handler: express.Router]> = [
  ["/auth", authRoutes],
  ["/analytics", analyticsRoutes],
  ["/bills", billRoutes],
  ["/customers", customerRoutes],
  ["/ingredients", ingredientRoutes],
  ["/inventory", inventoryRoutes],
  ["/restaurant", restaurantRoutes],
  ["/running-orders", runningOrderRoutes],
  ["/settings", settingsRoutes],
  ["/admin", adminRoutes],
  ["/reports", reportsRoutes],
  ["/cash", cashRoutes],
  ["/attendance", attendanceRoutes],
  ["/orders", ordersRoutes],
  ["/vendors", vendorRoutes],
  ["/sop", sopRoutes],
  ["/addons", addonRoutes],
  ["/discounts", discountRoutes],
  ["/procurement", procurementRoutes],
  ["/finance", financeRoutes],
  ["/finance-assumptions", financeAssumptionsRoutes],
  ["/budgets", budgetRoutes],
  ["/scenarios", scenarioRoutes],
  ["/forecasts", forecastRoutes],
  ["/investments", investmentRoutes],
  ["/executive", executiveRoutes],
  ["/ai", aiRoutes],
  ["/dues", duesRoutes],
  ["/emi", emiRoutes],
  ["/equipment", equipmentRoutes],
  ["/labor", laborRoutes],
  ["/compliance", complianceRoutes],
  ["/whatsapp", whatsappRoutes],
  ["/cashflow", cashflowRoutes],
  ["/banking", bankingRoutes],

  // DineInk internal operations console. Separate authentication, separate
  // authorization (permission-based, not restaurant-scoped) — see
  // modules/internal/internal.routes.ts.
  ["/internal", internalRoutes],
];

for (const [path, handler] of MODULES) {
  router.use(path, guardIdParams(handler));
}

export default router;
