// Thrown by service functions that look up a running order, batch item,
// table, or branch by its own id (none carry restaurantId in the route)
// once the row is fetched and its restaurantId doesn't match the caller's
// own. The controller maps this to HTTP 403.
export class ForbiddenError extends Error {}
