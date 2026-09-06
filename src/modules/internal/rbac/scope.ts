import prisma from "../../../config/prisma";
import { forbidden, notFound } from "../shared/apiError";

/**
 * Customer data scoping.
 *
 * Permissions decide *what* an employee may do. This decides *to whom*. Before
 * this existed the two were the same question, so granting anyone ACCOUNT_VIEW
 * granted them every customer DineInk has — fine at six accounts, indefensible
 * at six hundred.
 *
 * A role carries `accountScope`:
 *
 *   ALL_ACCOUNTS       platform-wide reach. Support and Finance need it: a
 *                      caller reaches whoever answers, and an invoice query
 *                      spans the whole book.
 *   ASSIGNED_ACCOUNTS  only accounts the employee appears against in
 *                      AccountAssignment, or owns outright.
 *
 * An employee holding several roles gets the widest scope any of them grants —
 * the same way permissions union rather than intersect. Anything else would
 * make adding a narrow role to someone silently *remove* access.
 *
 * Two entry points, and both matter:
 *
 *   `accountWhere()`   folded into every list query, so out-of-scope rows are
 *                      never selected in the first place.
 *   `assertAccountAccess()` guards every by-id route, because a list filter does
 *                      nothing for someone who types the id directly.
 *
 * A scoped miss is reported as 404, not 403. Telling an employee "that account
 * exists but is not yours" leaks the shape of the customer base to someone who
 * has already gone looking for it.
 */

export type AccountScope = "ALL_ACCOUNTS" | "ASSIGNED_ACCOUNTS";

export interface ScopeContext {
  employeeId: number;
  scope: AccountScope;
}

/** The widest scope any of the caller's roles grants. */
export const resolveScope = (roles: { accountScope?: string | null }[] | undefined): AccountScope =>
  roles?.some((role) => role.accountScope === "ALL_ACCOUNTS") ? "ALL_ACCOUNTS" : "ASSIGNED_ACCOUNTS";

export const scopeOf = (req: any): ScopeContext => ({
  employeeId: req.internal?.id,
  scope: (req.internal?.accountScope as AccountScope) ?? "ASSIGNED_ACCOUNTS",
});

export const hasGlobalScope = (req: any): boolean => scopeOf(req).scope === "ALL_ACCOUNTS";

/**
 * A Prisma `where` fragment restricting Account rows to what the caller may
 * reach. Spread into an existing filter:
 *
 *   where: { ...accountWhere(req), status: "CUSTOMER" }
 *
 * Returns `{}` for a global-scope caller so the query is unchanged.
 */
export const accountWhere = (req: any): Record<string, unknown> => {
  const { employeeId, scope } = scopeOf(req);
  if (scope === "ALL_ACCOUNTS") return {};
  return {
    OR: [{ ownerId: employeeId }, { assignments: { some: { employeeId } } }],
  };
};

/**
 * The same restriction expressed against a model that *references* an account,
 * for filtering subscriptions, invoices, tickets and so on.
 *
 *   where: { ...relatedAccountWhere(req), status: "ISSUED" }
 */
export const relatedAccountWhere = (req: any, field = "account"): Record<string, unknown> => {
  const { employeeId, scope } = scopeOf(req);
  if (scope === "ALL_ACCOUNTS") return {};
  return {
    [field]: {
      OR: [{ ownerId: employeeId }, { assignments: { some: { employeeId } } }],
    },
  };
};

/** The ids the caller can reach, for raw-SQL aggregates that cannot take a Prisma filter. */
export const accessibleAccountIds = async (req: any): Promise<number[] | null> => {
  const { employeeId, scope } = scopeOf(req);
  if (scope === "ALL_ACCOUNTS") return null; // null = no restriction
  const rows = await prisma.account.findMany({
    where: { OR: [{ ownerId: employeeId }, { assignments: { some: { employeeId } } }] },
    select: { id: true },
  });
  return rows.map((row) => row.id);
};

/**
 * Guards a by-id route. Throws 404 when the account does not exist *or* is out
 * of scope — deliberately indistinguishable.
 */
export const assertAccountAccess = async (req: any, accountId: number): Promise<void> => {
  if (!Number.isInteger(accountId) || accountId <= 0) {
    throw notFound("No customer with that id.", "ACCOUNT_NOT_FOUND");
  }
  const { employeeId, scope } = scopeOf(req);

  const account = await prisma.account.findFirst({
    where: {
      id: accountId,
      ...(scope === "ALL_ACCOUNTS"
        ? {}
        : { OR: [{ ownerId: employeeId }, { assignments: { some: { employeeId } } }] }),
    },
    select: { id: true },
  });

  if (!account) throw notFound("No customer with that id.", "ACCOUNT_NOT_FOUND");
};

/**
 * Guards a route addressed by restaurant rather than by account — the tenant
 * screens, which reach the same customer data by a different door.
 *
 * A restaurant with no account is reachable only by a global-scope caller. That
 * state should not survive the backfill, but an unowned tenant must not become
 * a hole through which an assigned-only employee reads arbitrary data.
 */
export const assertRestaurantAccess = async (req: any, restaurantId: number): Promise<void> => {
  if (!Number.isInteger(restaurantId) || restaurantId <= 0) {
    throw notFound("Restaurant not found", "RESTAURANT_NOT_FOUND");
  }
  const { scope } = scopeOf(req);
  if (scope === "ALL_ACCOUNTS") return;

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { accountId: true },
  });
  if (!restaurant) throw notFound("Restaurant not found", "RESTAURANT_NOT_FOUND");
  if (!restaurant.accountId) {
    throw notFound("Restaurant not found", "RESTAURANT_NOT_FOUND");
  }
  await assertAccountAccess(req, restaurant.accountId);
};

/**
 * Express middleware form, for routes whose account id is a path parameter.
 * Prefer the explicit `assertAccountAccess` inside a service when the id has to
 * be derived from something else.
 */
export const requireAccountAccess = (param = "id") => {
  return async (req: any, _res: any, next: any) => {
    try {
      await assertAccountAccess(req, Number(req.params[param]));
      return next();
    } catch (error) {
      return next(error);
    }
  };
};

export const requireRestaurantAccess = (param = "id") => {
  return async (req: any, _res: any, next: any) => {
    try {
      await assertRestaurantAccess(req, Number(req.params[param]));
      return next();
    } catch (error) {
      return next(error);
    }
  };
};

/**
 * Refuses an action against an account the caller can see but must not change.
 * Used where read and write scopes differ; today they do not, so this exists to
 * keep the call sites honest rather than to add a second rule.
 */
export const assertAccountWritable = async (req: any, accountId: number): Promise<void> => {
  await assertAccountAccess(req, accountId);
  if (!req.internal) throw forbidden("Sign in to continue", "UNAUTHENTICATED");
};
