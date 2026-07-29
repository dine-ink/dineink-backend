// Thrown by service functions that look up an expense/inventory-adjustment by
// its own id (neither carries restaurantId in the route) once the row is
// fetched and its restaurantId doesn't match the caller's own. The controller
// maps this to HTTP 403.
export class ForbiddenError extends Error {}
