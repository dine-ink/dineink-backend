import express from "express";
import { sendWhatsAppMessage, getWhatsAppLogs } from "./whatsapp.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnRestaurant, requireRole } from "../../middleware/authorize";

const router = express.Router();

// WhatsApp messaging touches customer/vendor contact data and the outbound
// message log, so this module is gated to OWNER/MANAGER roles on top of the
// usual auth + tenant-ownership checks.
router.use(authMiddleware, requireRole("OWNER", "MANAGER"));

router.post("/send", sendWhatsAppMessage);
router.get("/:restaurantId", requireOwnRestaurant(), getWhatsAppLogs);

export default router;
