import type { NextFunction, Request, Response } from "express";
import { ApiError, newCorrelationId } from "../shared/apiError";

/**
 * The API's single error boundary.
 *
 * This was previously two anonymous closures at the bottom of `index.ts`, which
 * is a fine place for them right up until you want to test them or reason about
 * precedence. More importantly the old handler only understood `err.status`, so
 * an `ApiError`'s `code` and `details` — the fields the frontends branch on and
 * render per-field form errors from — were dropped on the way out for every
 * route outside `/api/internal`.
 */

/** Unmatched route. Registered after the routers, before the error handler. */
export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    code: "ROUTE_NOT_FOUND",
    message: `Cannot ${req.method} ${req.path}`,
  });
};

/**
 * Prisma failures that are really the caller's fault, mapped to the status the
 * caller deserves. Everything else about a Prisma error — the query text, the
 * column names — stays server-side.
 */
const fromPrisma = (err: any): ApiError | null => {
  switch (err?.code) {
    case "P2002": {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(", ") : undefined;
      return new ApiError(
        409,
        "DUPLICATE",
        target ? `That ${target} is already in use.` : "That value is already in use.",
      );
    }
    case "P2025":
      return new ApiError(404, "NOT_FOUND", "That record no longer exists.");
    case "P2003":
      return new ApiError(
        409,
        "FOREIGN_KEY",
        "That record is still referenced by something else and can't be changed.",
      );
    default:
      return null;
  }
};

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);

  const known = err instanceof ApiError ? err : fromPrisma(err);

  if (known) {
    return res.status(known.status).json({
      success: false,
      code: known.code,
      message: known.message,
      ...(known.details ? { details: known.details } : {}),
    });
  }

  // Anything raised as a plain `Error` with a 4xx `status` — the pattern the
  // older modules use — is still deliberate, so its message is safe to forward.
  const status = Number(err?.status) || 500;
  if (status >= 400 && status < 500) {
    return res.status(status).json({
      success: false,
      code: err?.code ?? "REQUEST_FAILED",
      message: err?.message || "Request failed",
    });
  }

  const correlationId = newCorrelationId();
  console.error(
    `[api] ${correlationId} ${req.method} ${req.originalUrl} user=${(req as any).user?.id ?? "anonymous"}`,
    err,
  );
  return res.status(500).json({
    success: false,
    code: "INTERNAL_ERROR",
    message: "Something went wrong on our side. Quote this reference if you report it.",
    correlationId,
  });
};
