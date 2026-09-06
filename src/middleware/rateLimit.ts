import rateLimit, { type Options } from "express-rate-limit";

/**
 * Rate limiting.
 *
 * The internal console already locks an account after five bad passwords, but
 * that is per-account and does nothing about the attacks that matter at the
 * edge: spraying one password across many accounts, flooding password-reset to
 * burn the mail quota, or hammering an expensive report endpoint.
 *
 * These limits are in-memory, which means they are per-instance: two API
 * instances give an attacker twice the budget. That is a real limitation and is
 * fine at the current scale, but a shared store (Redis) is the right answer once
 * the API runs more than a couple of instances. It is called out rather than
 * pretended away.
 */

const shared: Partial<Options> = {
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // The response has to match the API's error shape, otherwise the frontend's
  // errorMessage() falls through to "Something went wrong" for what is actually
  // an actionable, self-resolving condition.
  handler: (_req, res, _next, options) =>
    res.status(options.statusCode).json({
      success: false,
      code: "RATE_LIMITED",
      message: "Too many requests. Wait a moment and try again.",
    }),
};

/** Coarse ceiling for the whole API. Generous — this is a backstop, not a policy. */
export const globalRateLimiter = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: Number(process.env.RATE_LIMIT_GLOBAL_PER_MINUTE ?? 600),
  // Health checks and the uptime probe must never be throttled.
  skip: (req) => req.path === "/" || req.path === "/api/health",
});

/**
 * Credential endpoints, keyed by IP. Deliberately strict: a legitimate person
 * signs in once or twice, and the per-account lockout handles the rest.
 */
export const authRateLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60_000,
  limit: Number(process.env.RATE_LIMIT_AUTH_PER_15MIN ?? 20),
  handler: (_req, res, _next, options) =>
    res.status(options.statusCode).json({
      success: false,
      code: "RATE_LIMITED",
      message: "Too many sign-in attempts from this address. Try again in a few minutes.",
    }),
});

/**
 * Password reset and other mail-sending endpoints. Tighter still, because the
 * cost of abuse is someone else's inbox and our sending reputation.
 */
export const passwordResetRateLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60_000,
  limit: Number(process.env.RATE_LIMIT_RESET_PER_HOUR ?? 10),
  handler: (_req, res, _next, options) =>
    res.status(options.statusCode).json({
      success: false,
      code: "RATE_LIMITED",
      message: "Too many password reset requests. Try again later.",
    }),
});

/**
 * Report generation and exports — each one can scan thousands of rows, so a
 * loop over this endpoint is a database problem, not just a bandwidth one.
 */
export const reportRateLimiter = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: Number(process.env.RATE_LIMIT_REPORTS_PER_MINUTE ?? 20),
});
