import express from "express";
import {
  sendWhatsAppMessage,
  getWhatsAppLogs,
  createTemplate,
  listTemplates,
  updateTemplate,
  deleteTemplate,
  sendBulkWhatsAppMessage,
} from "./whatsapp.controller";
import { authMiddleware } from "../../middleware/auth";
import { requireOwnRestaurant, requireRole } from "../../middleware/authorize";

const router = express.Router();

// WhatsApp messaging touches customer/vendor contact data and the outbound
// message log, so this module is gated to OWNER/MANAGER roles on top of the
// usual auth + tenant-ownership checks.
router.use(authMiddleware, requireRole("OWNER", "MANAGER"));

router.post("/send", sendWhatsAppMessage);
router.get("/:restaurantId", requireOwnRestaurant(), getWhatsAppLogs);

router.post("/templates/:restaurantId", requireOwnRestaurant(), createTemplate);
router.get("/templates/:restaurantId", requireOwnRestaurant(), listTemplates);
router.put("/templates/:restaurantId/:templateId", requireOwnRestaurant(), updateTemplate);
router.delete("/templates/:restaurantId/:templateId", requireOwnRestaurant(), deleteTemplate);
router.post("/send-bulk/:restaurantId", requireOwnRestaurant(), sendBulkWhatsAppMessage);

export default router;
