import { Response } from "express";
import {
  sendWhatsAppMessageService,
  getWhatsAppLogsService,
  createWhatsAppTemplateService,
  listWhatsAppTemplatesService,
  updateWhatsAppTemplateService,
  deleteWhatsAppTemplateService,
  sendBulkWhatsAppMessageService,
} from "./whatsapp.service";
import {
  ForbiddenError,
  ValidationError,
  validateCreateTemplatePayload,
  validateUpdateTemplatePayload,
  validateBulkSendPayload,
} from "./whatsapp.validation";

const handleError = (error: any, res: Response, message: string) => {
  console.log(error);
  if (error instanceof ForbiddenError) {
    return res.status(403).json({ success: false, message: error.message });
  }
  if (error instanceof ValidationError) {
    return res.status(400).json({ success: false, message: error.message });
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

export const createTemplate = async (req: any, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const payload = validateCreateTemplatePayload(req.body);
    const data = await createWhatsAppTemplateService(restaurantId, payload, req.user.id);
    return res.status(201).json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to create template");
  }
};

export const listTemplates = async (req: any, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const data = await listWhatsAppTemplatesService(restaurantId);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to fetch templates");
  }
};

export const updateTemplate = async (req: any, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const templateId = Number(req.params.templateId);
    const payload = validateUpdateTemplatePayload(req.body);
    const data = await updateWhatsAppTemplateService(restaurantId, templateId, payload);
    return res.json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to update template");
  }
};

export const deleteTemplate = async (req: any, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const templateId = Number(req.params.templateId);
    await deleteWhatsAppTemplateService(restaurantId, templateId);
    return res.json({ success: true });
  } catch (err: any) {
    return handleError(err, res, "Failed to delete template");
  }
};

export const sendBulkWhatsAppMessage = async (req: any, res: Response) => {
  try {
    const restaurantId = Number(req.params.restaurantId);
    const payload = validateBulkSendPayload(req.body);
    const data = await sendBulkWhatsAppMessageService(restaurantId, payload, req.user.id);
    return res.status(201).json({ success: true, data });
  } catch (err: any) {
    return handleError(err, res, "Failed to send bulk WhatsApp message");
  }
};
