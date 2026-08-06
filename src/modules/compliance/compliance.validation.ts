// Thrown by service functions that look up a compliance record by its own id
// (the route only carries the record id, not restaurantId/branchId) once the
// row is fetched and its restaurantId doesn't match the caller's own. The
// controller maps this to HTTP 403.
export class ForbiddenError extends Error {}
