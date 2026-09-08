import jwt from "jsonwebtoken";
import prisma from "../../../config/prisma";
import type { Permission } from "./permissions";
import { resolveScope, type AccountScope } from "./scope";

/**
 * Authentication and authorization for every /api/internal route.
 *
 * Three things separate this from the restaurant apps' `authMiddleware`:
 *
 *  1. **A different actor.** Internal tokens carry `typ: "internal"` and are
 *     issued only by the internal login. A restaurant user's token can never
 *     satisfy this middleware even though both are signed with the same secret,
 *     because step 2 has no row for it.
 *
 *  2. **Sessions are revocable.** The restaurant apps issue bare stateless JWTs,
 *     which stay valid for their full 7 days no matter what happens to the
 *     account. A console that can suspend restaurants and approve refunds can't
 *     work that way, so every token's `jti` is matched against InternalSession
 *     on each request — disabling an employee or revoking a session cuts access
 *     immediately.
 *
 *  3. **Permissions are loaded per request** from the employee's current roles,
 *     so a permission change takes effect on the very next call rather than at
 *     the next login.
 */

export interface InternalAuthContext {
  id: number;
  employeeCode: string;
  email: string;
  name: string;
  sessionId: number;
  tokenId: string;
  roles: { id: number; key: string; name: string; accountScope: AccountScope }[];
  permissions: Set<string>;
  /**
   * How much of the customer base this employee can reach — the widest scope
   * any of their roles grants. Loaded per request alongside permissions so a
   * scope change takes effect on the next call rather than the next login.
   */
  accountScope: AccountScope;
  mustChangePassword: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      internal?: InternalAuthContext;
    }
  }
}

export const INTERNAL_TOKEN_TYPE = "internal";

/**
 * The signing key for internal tokens.
 *
 * A dedicated secret matters because an internal token and a restaurant token
 * signed with the same key are cryptographically interchangeable — the only
 * thing separating them is the session-row lookup below, which is one layer
 * where there should be two.
 *
 * The fallback to JWT_SECRET remains so a local checkout of the restaurant apps
 * still runs, but `assertSecretsConfigured()` refuses to start a production
 * process without a dedicated one, so the fallback can no longer quietly become
 * the production configuration.
 */
export const getInternalJwtSecret = (): string => {
  const dedicated = process.env.INTERNAL_JWT_SECRET;
  if (dedicated) return dedicated;
  const shared = process.env.JWT_SECRET;
  if (!shared) throw new Error("INTERNAL_JWT_SECRET (or JWT_SECRET) must be set");
  return shared;
};

// Writing lastSeenAt on every single request would add a row update to each
// call for no operational benefit — a five-minute resolution is plenty for
// "when was this session last used" in the sessions list.
const LAST_SEEN_REFRESH_MS = 5 * 60 * 1000;

export const clientIp = (req: any): string | undefined => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) return forwarded.split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || undefined;
};

export const internalAuth = async (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader.split(" ")[0] !== "Bearer") {
    return res.status(401).json({ success: false, code: "UNAUTHENTICATED", message: "Sign in to continue" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ success: false, code: "UNAUTHENTICATED", message: "Sign in to continue" });
  }

  let payload: any;
  try {
    payload = jwt.verify(token, getInternalJwtSecret());
  } catch (error: any) {
    if (error?.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, code: "SESSION_EXPIRED", message: "Your session has expired. Please sign in again." });
    }
    return res.status(401).json({ success: false, code: "UNAUTHENTICATED", message: "Sign in to continue" });
  }

  if (payload?.typ !== INTERNAL_TOKEN_TYPE || !payload?.jti) {
    return res.status(401).json({ success: false, code: "UNAUTHENTICATED", message: "Sign in to continue" });
  }

  const session = await prisma.internalSession.findUnique({
    where: { tokenId: payload.jti },
    include: {
      user: {
        include: { roles: { include: { role: { include: { permissions: true } } } } },
      },
    },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    return res.status(401).json({ success: false, code: "SESSION_EXPIRED", message: "Your session has ended. Please sign in again." });
  }
  if (session.user.status !== "ACTIVE") {
    return res.status(403).json({ success: false, code: "ACCOUNT_DISABLED", message: "This account is no longer active." });
  }

  if (Date.now() - session.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
    // Fire-and-forget: a failed heartbeat must never fail the request.
    prisma.internalSession
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }

  const permissions = new Set<string>();
  for (const link of session.user.roles) {
    for (const p of link.role.permissions) permissions.add(p.permission);
  }

  req.internal = {
    id: session.user.id,
    employeeCode: session.user.employeeCode,
    email: session.user.email,
    name: session.user.name,
    sessionId: session.id,
    tokenId: session.tokenId,
    roles: session.user.roles.map((r) => ({
      id: r.role.id,
      key: r.role.key,
      name: r.role.name,
      accountScope: r.role.accountScope as AccountScope,
    })),
    permissions,
    accountScope: resolveScope(session.user.roles.map((r) => r.role)),
    mustChangePassword: session.user.mustChangePassword,
  } satisfies InternalAuthContext;

  return next();
};

export const hasPermission = (req: any, permission: Permission): boolean =>
  Boolean(req.internal?.permissions?.has(permission));

export const hasAnyPermission = (req: any, ...permissions: Permission[]): boolean =>
  permissions.some((p) => hasPermission(req, p));

/**
 * Route guard. Always paired with `internalAuth`, never used alone.
 *
 * The frontend also hides actions the employee can't perform, but that is
 * presentation only — this is the check that actually decides.
 */
export const requirePermission = (...permissions: Permission[]) => {
  return (req: any, res: any, next: any) => {
    if (!req.internal) {
      return res.status(401).json({ success: false, code: "UNAUTHENTICATED", message: "Sign in to continue" });
    }
    const missing = permissions.filter((p) => !req.internal.permissions.has(p));
    if (missing.length) {
      return res.status(403).json({
        success: false,
        code: "PERMISSION_DENIED",
        message: "You don't have permission to do that.",
        // Naming the missing permission lets the UI explain what to request
        // from an administrator instead of showing a bare "denied".
        requiredPermissions: missing,
      });
    }
    return next();
  };
};

export const requireAnyPermission = (...permissions: Permission[]) => {
  return (req: any, res: any, next: any) => {
    if (!req.internal) {
      return res.status(401).json({ success: false, code: "UNAUTHENTICATED", message: "Sign in to continue" });
    }
    if (!permissions.some((p) => req.internal.permissions.has(p))) {
      return res.status(403).json({
        success: false,
        code: "PERMISSION_DENIED",
        message: "You don't have permission to do that.",
        requiredPermissions: permissions,
      });
    }
    return next();
  };
};
