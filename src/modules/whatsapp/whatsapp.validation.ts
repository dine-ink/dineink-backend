// Thrown by service functions that look up a WhatsApp message log (or other
// scoped row) once fetched and its restaurantId doesn't match the caller's
// own. The controller maps this to HTTP 403.
export class ForbiddenError extends Error {}
