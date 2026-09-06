import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Route ordering.
 *
 * Regression test for a real bug: `router.use("/:id", requireRestaurantAccess)`
 * was registered above `router.get("/filter-options")`. Express matches in
 * declaration order, so every request to /restaurants/filter-options was
 * captured by the `:id` middleware, which tried to read "filter-options" as a
 * number and 404'd a route that exists.
 *
 * The failure was invisible to typecheck, to lint and to every unit test — it
 * only showed up when the page was opened in a browser. This asserts the
 * ordering directly so it cannot come back.
 */

const routeFile = (relative: string) =>
  fs.readFileSync(path.join(__dirname, relative), "utf8");

/** Literal path segments that must not be swallowed by a `:id` matcher. */
const LITERAL_COLLECTION_ROUTES = ["filter-options", "meta", "counts", "assignable", "departments", "permissions", "stages", "pipeline"];

const positionOfParamMiddleware = (source: string) => {
  const match = source.match(/router\.use\(\s*"\/:\w+"/);
  return match?.index ?? -1;
};

describe("route ordering", () => {
  it("registers literal collection routes before any /:id middleware", () => {
    const files = [
      "restaurants/restaurants.routes.ts",
      "accounts/accounts.routes.ts",
      "tickets/tickets.routes.ts",
      "commercial/commercial.routes.ts",
      "onboarding/onboarding.routes.ts",
      "sales/sales.routes.ts",
    ];

    for (const file of files) {
      const source = routeFile(`./${file}`);
      const paramMiddlewareAt = positionOfParamMiddleware(source);
      if (paramMiddlewareAt === -1) continue; // no path-scoped middleware in this router

      for (const literal of LITERAL_COLLECTION_ROUTES) {
        const literalAt = source.indexOf(`"/${literal}"`);
        if (literalAt === -1) continue;
        expect(
          literalAt,
          `${file}: "/${literal}" is registered after the /:id middleware, so it will be matched as an id`,
        ).toBeLessThan(paramMiddlewareAt);
      }
    }
  });

  it("keeps the restaurants scope guard mounted at all", () => {
    // The ordering fix moved the guard; this makes sure it was moved and not
    // deleted, because a router with no scope check is the worse bug.
    const source = routeFile("./restaurants/restaurants.routes.ts");
    expect(source).toMatch(/router\.use\(\s*"\/:id",\s*requireRestaurantAccess/);
  });
});
