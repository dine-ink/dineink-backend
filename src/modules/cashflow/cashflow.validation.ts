// Mirrors the ForbiddenError convention used by every other financially
// sensitive module (emi.validation.ts, compliance.validation.ts, ...) so
// cashflow.controller.ts can special-case it into a 403 the same way
// emi.controller.ts's handleError does, even though the current service
// functions here are read-only (route-level requireOwnRestaurant()/
// requireOwnBranch() already gate access before the service ever runs).
export class ForbiddenError extends Error {}
