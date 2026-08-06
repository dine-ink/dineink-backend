// Thrown by service functions that look up a MonthlyDue row by its own id
// (the route doesn't carry restaurantId for update/delete) once the row is
// fetched and its restaurantId doesn't match the caller's own. The
// controller maps this to HTTP 403.
export class ForbiddenError extends Error {}
