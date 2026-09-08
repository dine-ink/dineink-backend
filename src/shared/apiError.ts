import crypto from "crypto";

/**
 * The application's error type.
 *
 * This started life inside `modules/internal/shared` and was only reachable by
 * the internal console. Everywhere else, each module declared its own
 * `class ValidationError extends Error {}` — eleven of them — and every
 * controller re-implemented the mapping from "which error is this" to "which
 * status code". That meant a module's error contract was whatever its author
 * remembered: some returned 400 for a missing row, some 500, and a caller had
 * no stable field to branch on.
 *
 * One type, raised anywhere, translated once by the error middleware:
 *
 *   - `status`  — the HTTP status, decided where the error is raised, by the
 *                 code that actually knows what went wrong.
 *   - `code`    — a stable machine-readable string the frontends branch on.
 *                 Messages get rewritten; codes are the contract.
 *   - `message` — a sentence written for a person, safe to show as-is.
 *   - `details` — optional per-field information, so a form can put a message
 *                 next to the input that caused it.
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

export const unauthorized = (message: string, code = "UNAUTHORIZED") =>
  new ApiError(401, code, message);

export const forbidden = (message: string, code = "PERMISSION_DENIED") =>
  new ApiError(403, code, message);

export const notFound = (message: string, code = "NOT_FOUND") => new ApiError(404, code, message);

export const conflict = (message: string, code = "CONFLICT") => new ApiError(409, code, message);

/** A request that is well-formed but not allowed by a business rule. */
export const invalidState = (message: string, code = "INVALID_STATE", details?: unknown) =>
  new ApiError(422, code, message, details);

export const tooManyRequests = (message: string, code = "TOO_MANY_REQUESTS") =>
  new ApiError(429, code, message);

export const serviceUnavailable = (message: string, code = "SERVICE_UNAVAILABLE") =>
  new ApiError(503, code, message);

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

/**
 * A route segment as an id the Int column can actually hold, or null.
 *
 * `/restaurants/99999999999999999999` parses to 1e20, which overflows int4 and
 * makes the write itself fail with a driver error rather than a validation one.
 */
export const toInt32 = (raw: string | undefined): number | null => {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647 ? value : null;
};

/** A short, quotable reference printed in the log next to the real error. */
export const newCorrelationId = () => crypto.randomBytes(6).toString("hex");
