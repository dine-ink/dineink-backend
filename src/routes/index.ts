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

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/bills", billRoutes);
router.use("/customers", customerRoutes);
router.use("/ingredients", ingredientRoutes);
router.use("/inventory", inventoryRoutes);
router.use("/restaurant", restaurantRoutes);
router.use("/running-orders", runningOrderRoutes);
router.use("/settings", settingsRoutes);
router.use("/admin", adminRoutes);
router.use("/reports", reportsRoutes);
router.use("/cash", cashRoutes);
router.use("/attendance", attendanceRoutes);
router.use("/orders", ordersRoutes);
router.use("/vendors", vendorRoutes);
router.use("/sop", sopRoutes);

export default router;
