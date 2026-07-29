export class ValidationError extends Error {}

// Thrown by service functions that look up a resource by its own id (table,
// staff, category, menu item — none of these carry restaurantId in the
// route) once the row is fetched and its restaurantId doesn't match the
// caller's own. The controller maps this to HTTP 403.
export class ForbiddenError extends Error {}
