// Thrown by service functions that look up a banking row (bank account /
// UPI config / bank transaction entry) by its own id — the route only
// carries that row's id, not restaurantId — once the row is fetched and its
// restaurantId doesn't match the caller's own. The controller maps this to
// HTTP 403. Mirrors the same pattern used by emi.validation.ts and
// vendor.validation.ts.
export class ForbiddenError extends Error {}
