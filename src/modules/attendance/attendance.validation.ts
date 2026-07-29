// Thrown when a manual attendance override targets an employee or branch
// that doesn't belong to the caller's own restaurant. The controller maps
// this to HTTP 403.
export class ForbiddenError extends Error {}
