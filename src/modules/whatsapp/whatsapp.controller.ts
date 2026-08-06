import { Response } from "express";
import { sendWhatsAppMessageService, getWhatsAppLogsService } from "./whatsapp.service";
import { ForbiddenError } from "./whatsapp.validation";

const handleError = (error: any, res: Response, message: string) => {
  console.log(error);
  if (error instanceof ForbiddenError) {
    return res.status(403).json({ success: false, message: error.message });
  }
  return res.status(500).json({ success: false, message: error.message || message });
};

export const sendWhatsAppMessage = async (req: any, res: Response) => {
  try {
    const data = await sendWhatsAppMessageService(Number(req.user.restaurantId), {
      ...req.body,
      createdById: req.user.id,
    });
    return res.status(201).json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to send WhatsApp message");
  }
};

export const getWhatsAppLogs = async (req: any, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const branchId = req.query.branchId !== undefined ? Number(req.query.branchId) : undefined;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    const data = await getWhatsAppLogsService(restaurantId, branchId, limit);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to fetch WhatsApp logs");
  }
};
