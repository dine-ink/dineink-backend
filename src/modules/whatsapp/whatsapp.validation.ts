// Thrown by service functions that look up a WhatsApp message log (or other
// scoped row) once fetched and its restaurantId doesn't match the caller's
// own. The controller maps this to HTTP 403.
export class ForbiddenError extends Error {}

// Thrown for client-correctable input problems (missing/oversized fields,
// the 5-template cap). The controller maps this to HTTP 400.
export class ValidationError extends Error {}

export const MAX_WHATSAPP_TEMPLATES = 5;
const MAX_TEMPLATE_NAME_LENGTH = 60;
const MAX_TEMPLATE_MESSAGE_LENGTH = 1000;

export const validateCreateTemplatePayload = (body: any): { name: string; message: string } => {
  if (!body || typeof body !== "object") throw new ValidationError("Request body is required");
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!name) throw new ValidationError("'name' is required");
  if (name.length > MAX_TEMPLATE_NAME_LENGTH) throw new ValidationError(`'name' must be at most ${MAX_TEMPLATE_NAME_LENGTH} characters`);
  if (!message) throw new ValidationError("'message' is required");
  if (message.length > MAX_TEMPLATE_MESSAGE_LENGTH) throw new ValidationError(`'message' must be at most ${MAX_TEMPLATE_MESSAGE_LENGTH} characters`);
  return { name, message };
};

export const validateUpdateTemplatePayload = (body: any): { name?: string; message?: string } => {
  if (!body || typeof body !== "object") throw new ValidationError("Request body is required");
  const payload: { name?: string; message?: string } = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new ValidationError("'name' must be a non-empty string");
    if (name.length > MAX_TEMPLATE_NAME_LENGTH) throw new ValidationError(`'name' must be at most ${MAX_TEMPLATE_NAME_LENGTH} characters`);
    payload.name = name;
  }
  if (body.message !== undefined) {
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) throw new ValidationError("'message' must be a non-empty string");
    if (message.length > MAX_TEMPLATE_MESSAGE_LENGTH) throw new ValidationError(`'message' must be at most ${MAX_TEMPLATE_MESSAGE_LENGTH} characters`);
    payload.message = message;
  }
  return payload;
};

export const validateBulkSendPayload = (body: any): { templateId: number; customerIds: number[]; branchId: number | null } => {
  if (!body || typeof body !== "object") throw new ValidationError("Request body is required");
  const templateId = Number(body.templateId);
  if (!Number.isFinite(templateId) || templateId <= 0) throw new ValidationError("A valid 'templateId' is required");
  if (!Array.isArray(body.customerIds) || body.customerIds.length === 0) {
    throw new ValidationError("'customerIds' must be a non-empty array");
  }
  const numericIds: number[] = body.customerIds.map((id: unknown) => Number(id));
  const customerIds: number[] = numericIds.filter((id, index) => numericIds.indexOf(id) === index);
  if (customerIds.some((id) => !Number.isFinite(id) || id <= 0)) {
    throw new ValidationError("'customerIds' must contain only positive numbers");
  }
  const branchId = body.branchId !== undefined && body.branchId !== null ? Number(body.branchId) : null;
  return { templateId, customerIds, branchId };
};
