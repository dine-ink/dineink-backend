import prisma from "../config/prisma";

// authMiddleware only verifies the JWT is valid — it never checked that the
// restaurantId in the URL/body actually belongs to the caller, so any
// authenticated user could reach another restaurant's data by editing the
// URL. These two middlewares close that gap; routes whose ownership can't be
// determined from a URL param (a resource looked up by its own id) instead
// verify ownership inside the service function once the row is fetched.

// Compares req.params[paramName] against the caller's own restaurantId from
// the JWT. Routes that don't carry restaurantId in params (e.g. it's only in
// the body) are left alone — validate those at the controller/service level.
export const requireOwnRestaurant = (paramName: string = "restaurantId") => {
  return (req: any, res: any, next: any) => {
    const paramValue = req.params[paramName];
    if (paramValue === undefined) return next();
    if (Number(paramValue) !== Number(req.user?.restaurantId)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    return next();
  };
};

export const requireRole = (...roles: string[]) => {
  return (req: any, res: any, next: any) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    return next();
  };
};

// Many routes only carry a branchId in params, not restaurantId — a branch
// doesn't say which restaurant it belongs to just from its numeric id, so
// this looks it up and compares against the caller's own restaurantId.
export const requireOwnBranch = (paramName: string = "branchId") => {
  return async (req: any, res: any, next: any) => {
    // branchId is sometimes a route param, sometimes a query string (e.g.
    // cash sessions) — check both rather than forcing every caller to match.
    const paramValue = req.params[paramName] ?? req.query[paramName];
    if (paramValue === undefined) return next();
    try {
      const branch = await prisma.branch.findUnique({
        where: { id: Number(paramValue) },
        select: { restaurantId: true },
      });
      if (!branch || branch.restaurantId !== Number(req.user?.restaurantId)) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
      return next();
    } catch {
      return res.status(400).json({ success: false, message: "Invalid branch" });
    }
  };
};
