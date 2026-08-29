import crypto from "crypto";
import prisma from "../../../config/prisma";

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

  // Persist it so the reference the employee is told to quote actually leads
  // somewhere. Fire-and-forget and swallowed: a failure to record the error
  // must never replace the error the caller is already getting.
  void persistApplicationLog(req, err, correlationId);
  return res.status(500).json({
    success: false,
    code: "INTERNAL_ERROR",
    message: "Something went wrong on our side. Quote this reference if you report it.",
    correlationId,
  });
};

/**
 * A route segment as an id the Int column can actually hold, or null.
 *
 * `/restaurants/99999999999999999999` parses to 1e20, which overflows int4 and
 * makes the *write itself* fail — so the one error worth recording is the one
 * that gets silently dropped. Anything out of range is recorded as no id: the
 * failure still lands, just without a context link it never had.
 */
export const toInt32 = (raw: string | undefined): number | null => {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647 ? value : null;
};

/**
 * Writes one unexpected failure to ApplicationLog.
 *
 * Ids are parsed out of the route so an engineer can search by the order or
 * restaurant a failure concerned, not only by its correlation id — "every error
 * touching RES-248 this week" is the question that actually gets asked.
 */
const persistApplicationLog = async (req: any, err: any, correlationId: string) => {
  try {
    const url: string = req.originalUrl ?? "";
    const restaurantMatch = url.match(/\/restaurants\/(\d+)/);
    const orderMatch = url.match(/\/(?:orders|transactions)\/(\d+)/);

    await prisma.applicationLog.create({
      data: {
        correlationId,
        level: "ERROR",
        service: "internal-api",
        method: req.method ?? null,
        // Query strings can carry a search term with someone's phone number in
        // it; the path alone is what makes a log line useful.
        path: url.split("?")[0] || null,
        statusCode: 500,
        message: String(err?.message ?? err).slice(0, 2000),
        stack: typeof err?.stack === "string" ? err.stack.slice(0, 8000) : null,
        actorId: req.internal?.id ?? null,
        actorEmail: req.internal?.email ?? null,
        restaurantId: toInt32(restaurantMatch?.[1]),
        orderId: toInt32(orderMatch?.[1]),
        ip: (typeof req.headers?.["x-forwarded-for"] === "string"
          ? req.headers["x-forwarded-for"].split(",")[0].trim()
          : req.ip) ?? null,
        userAgent: (req.headers?.["user-agent"] as string | undefined) ?? null,
      },
    });
  } catch (writeError) {
    console.error("[internal-api] could not persist application log", writeError);
  }
};
