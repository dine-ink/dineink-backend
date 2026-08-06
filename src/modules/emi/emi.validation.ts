// Thrown by service functions that look up an EMI schedule by its own id
// (the route only carries the schedule id, not restaurantId) once the row is
// fetched and its restaurantId doesn't match the caller's own. The
// controller maps this to HTTP 403.
export class ForbiddenError extends Error {}
