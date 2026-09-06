import prisma from "../../../config/prisma";
import { ApiError, newCorrelationId, toInt32 } from "../../../shared/apiError";

/**
 * The internal console's error handling.
 *
 * The error *type* and its factories now live in `src/shared/apiError` and are
 * used by the whole API — they were only ever internal-specific by accident of
 * where they were first written. What stays here is the one piece that really
 * is internal-only: an error handler that also writes the failure to
 * `ApplicationLog`, so the reference an employee is told to quote leads
 * somewhere an engineer can search.
 *
 * Re-exported below rather than moved outright, so the ~39 files already
 * importing from this path keep working.
 */
export {
  ApiError,
  asyncHandler,
  badRequest,
  conflict,
  forbidden,
  invalidState,
  notFound,
  serviceUnavailable,
  tooManyRequests,
  unauthorized,
  toInt32,
} from "../../../shared/apiError";

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
  const correlationId = newCorrelationId();
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
