// Thrown by service functions that look up an equipment row by its own id
// (the update/delete routes don't carry restaurantId in the URL) once the
// row is fetched and its restaurantId doesn't match the caller's own. The
// controller maps this to HTTP 403.
export class ForbiddenError extends Error {}
