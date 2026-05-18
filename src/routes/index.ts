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

export default router;
