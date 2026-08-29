import crypto from "crypto";

/**
 * Errors the internal application shows to employees.
 *
 * The brief is explicit that employees must never see a stack trace, and that
 * errors should be actionable and traceable. So: every failure carries a stable
 * `code` the frontend can branch on, a sentence written for a person, and — for
 * anything unexpected — a short correlation id that is printed in the server log
 * next to the real error. An employee can quote that id in a ticket without the
 * response ever having leaked internals.
 */
export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, code = "BAD_REQUEST", details?: unknown) =>
  new ApiError(400, code, message, details);

export const notFound = (message: string, code = "NOT_FOUND") => new ApiError(404, code, message);

export const forbidden = (message: string, code = "PERMISSION_DENIED") => new ApiError(403, code, message);

export const conflict = (message: string, code = "CONFLICT") => new ApiError(409, code, message);

/** A request that is well-formed but not allowed by a business rule. */
export const invalidState = (message: string, code = "INVALID_STATE", details?: unknown) =>
  new ApiError(422, code, message, details);

export const serviceUnavailable = (message: string, code = "SERVICE_UNAVAILABLE") =>
  new ApiError(503, code, message);

export const tooManyRequests = (message: string, code = "TOO_MANY_REQUESTS") =>
  new ApiError(429, code, message);

/**
 * Wraps an async route handler so a rejected promise reaches the error
 * middleware. Express 5 forwards rejections from async handlers on its own, but
 * being explicit keeps the behaviour independent of that.
 */
export const asyncHandler =
  (handler: (req: any, res: any, next: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

export const internalErrorHandler = (err: any, req: any, res: any, next: any) => {
  if (res.headersSent) return next(err);

  if (err instanceof ApiError) {
    return res.status(err.status).json({
      success: false,
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // Prisma's own errors carry query text and column names — never forwarded.
  const correlationId = crypto.randomBytes(6).toString("hex");
  console.error(
    `[internal-api] ${correlationId} ${req.method} ${req.originalUrl} actor=${req.internal?.email ?? "anonymous"}`,
    err,
  );
  return res.status(500).json({
    success: false,
    code: "INTERNAL_ERROR",
    message: "Something went wrong on our side. Quote this reference if you report it.",
    correlationId,
  });
};
