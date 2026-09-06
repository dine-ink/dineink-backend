import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { parseBody, parseParams, parseQuery } from "../shared/validate";

/**
 * Validation as route middleware.
 *
 * The existing modules validate inside the controller, which works but leaves
 * the route table silent about what an endpoint accepts — you have to open the
 * controller to find out, and a new route added next to the others inherits no
 * validation at all unless its author remembers. Declaring the schema in
 * `*.routes.ts` puts the contract next to the path, where it is visible in
 * review:
 *
 *   router.post("/login", validateBody(loginSchema), login);
 *
 * The parsed, coerced value replaces the raw one, so the handler receives
 * `req.body.restaurantId` as a number rather than the string Express gives it.
 * Failures are thrown as `ApiError`, so `errorHandler` renders them in the
 * API's own shape with per-field `details`.
 */

export const validateBody =
  <T>(schema: ZodType<T>) =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = parseBody(schema, req.body);
      next();
    } catch (error) {
      next(error);
    }
  };

/**
 * Express 5 makes `req.query` a getter with no setter, so the parsed result is
 * exposed as `req.validatedQuery` rather than assigned back over it. Handlers
 * that want the coerced values read that; everything else still sees the
 * untouched `req.query`.
 */
export const validateQuery =
  <T>(schema: ZodType<T>) =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      (req as any).validatedQuery = parseQuery(schema, req.query);
      next();
    } catch (error) {
      next(error);
    }
  };

export const validateParams =
  <T>(schema: ZodType<T>) =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      (req as any).validatedParams = parseParams(schema, req.params);
      next();
    } catch (error) {
      next(error);
    }
  };
