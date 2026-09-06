import type { Router } from "express";
import { badRequest } from "../shared/apiError";

/**
 * Every numeric route parameter, validated in one place.
 *
 * Of the ~437 route parameters in the API, all but four are database ids —
 * `:id`, `:restaurantId`, `:branchId` and the rest below. None of them were
 * checked before reaching a handler, so `GET /bills/abc` became
 * `Number("abc")` → `NaN` → a Prisma error surfaced as a 500, and
 * `GET /restaurant/99999999999999999999` overflowed int4 and failed in the
 * driver. Both are the caller's mistake and both should be a 400 that says so.
 *
 * This is deliberately a `router.param` handler rather than a `router.use`
 * middleware: `req.params` is only populated by the router that matched the
 * route, so a `use` mounted at the top of `routes/index.ts` would see an empty
 * object. `router.param(name, fn)` fires when *that* router matches a route
 * declaring that name, which is exactly the hook needed — and registering a
 * name a given router never uses is harmless.
 *
 * The four non-numeric parameters (`:key`, `:type`, `:taskKey`, `:kpiKey`) are
 * not listed, and are validated by their own modules.
 */

const ID_PARAMS = [
  "id",
  "restaurantId",
  "branchId",
  "budgetId",
  "scenarioId",
  "vendorId",
  "tableId",
  "itemId",
  "investmentId",
  "userId",
  "stationId",
  "orderId",
  "menuItemId",
  "forecastId",
  "billId",
  "templateId",
  "contactId",
  "attachmentId",
  "sessionId",
  "ingredientId",
  "equipmentId",
  "employeeId",
  "addOnGroupId",
] as const;

/** Postgres `integer`. A value above this cannot be stored, so it cannot match. */
const MAX_INT4 = 2_147_483_647;

export const isValidId = (value: string): boolean => {
  // A leading "+", whitespace or "1e3" all coerce to a number but are not ids;
  // requiring digits keeps the accepted set the same as what the column holds.
  if (!/^\d+$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_INT4;
};

/**
 * Registers the guard for every known id parameter on one router. Call this
 * before mounting the router.
 */
export const guardIdParams = (router: Router): Router => {
  for (const name of ID_PARAMS) {
    router.param(name, (_req, _res, next, value) => {
      if (isValidId(String(value))) return next();
      next(badRequest(`'${name}' must be a positive whole number.`, "INVALID_ID"));
    });
  }
  return router;
};
