import type { CorsOptions } from "cors";

/**
 * CORS policy.
 *
 * This previously reflected whatever `Origin` the caller sent and paired it
 * with `credentials: true`, which is the browser-security equivalent of leaving
 * the door open: any website a signed-in employee visited could make
 * credentialed calls to this API on their behalf.
 *
 * The allowlist is derived from the deployment URLs the backend already knows
 * about — OWNER_WEB_URL and POS_URL are existing configuration — plus
 * INTERNAL_WEB_URL for the operations console. CORS_ALLOWED_ORIGINS can add
 * more (comma-separated) without a code change.
 *
 * Requests with no Origin header are allowed. That is not a hole: browsers
 * always send Origin on cross-origin requests, so a missing one means a native
 * app, a server-to-server call, or curl — none of which CORS protects anyway,
 * and all of which are still subject to authentication.
 */

const DEV_ORIGINS = [
  "http://localhost:5173", // owner-web
  "http://localhost:5174", // pos
  "http://localhost:5175", // internal-web
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:5175",
];

const normalize = (value: string) => value.trim().replace(/\/$/, "");

export const allowedOrigins = (): string[] => {
  const configured = [
    process.env.OWNER_WEB_URL,
    process.env.POS_URL,
    process.env.INTERNAL_WEB_URL,
    ...(process.env.CORS_ALLOWED_ORIGINS ?? "").split(","),
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map(normalize);

  // Development convenience only. In production the deployment sets the three
  // URL variables above and localhost is not in the list.
  const withDev = process.env.NODE_ENV === "production" ? configured : [...configured, ...DEV_ORIGINS];

  return Array.from(new Set(withDev));
};

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    const list = allowedOrigins();

    // A deployment that has configured nothing would otherwise refuse every
    // browser request, taking the restaurant apps down. Refusing to start is
    // worse than warning loudly, so this fails open *with a warning* — but only
    // when the allowlist is genuinely empty, not when an origin is merely absent
    // from a populated one.
    if (list.length === 0) {
      console.warn(
        "[cors] No allowed origins configured. Set OWNER_WEB_URL, POS_URL and INTERNAL_WEB_URL " +
          "(or CORS_ALLOWED_ORIGINS) — all origins are being accepted until you do.",
      );
      return callback(null, true);
    }

    if (list.includes(normalize(origin))) return callback(null, true);

    console.warn(`[cors] blocked origin ${origin}`);
    return callback(null, false);
  },
  credentials: true,
};
