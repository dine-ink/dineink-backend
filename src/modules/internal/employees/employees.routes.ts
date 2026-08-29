import { Router } from "express";
import { internalAuth, requirePermission } from "../rbac/internalAuth.middleware";
import { PERMISSIONS as P } from "../rbac/permissions";
import { asyncHandler, badRequest } from "../shared/apiError";
import * as service from "./employees.service";

const router = Router();
router.use(internalAuth);

const employeeId = (req: any) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("That isn't a valid employee id.", "INVALID_ID");
  return id;
};

router.get(
  "/",
  requirePermission(P.EMPLOYEE_VIEW),
  asyncHandler(async (req, res) => {
    const data = await service.listEmployees(req.query as any);
    return res.json({ success: true, data });
  }),
);

/**
 * The assignable-employee list is reachable with TICKET_ASSIGN as well as
 * EMPLOYEE_VIEW: assigning a ticket requires knowing who exists, and support
 * agents who assign work have no reason to hold employee administration rights.
 * It returns names and departments only — never status, roles or login history.
 */
router.get(
  "/assignable",
  (req: any, res, next) =>
    req.internal?.permissions?.has(P.TICKET_ASSIGN) || req.internal?.permissions?.has(P.EMPLOYEE_VIEW)
      ? next()
      : res.status(403).json({ success: false, code: "PERMISSION_DENIED", message: "You don't have permission to do that." }),
  asyncHandler(async (_req, res) => {
    const data = await service.listAssignableEmployees();
    return res.json({ success: true, data });
  }),
);

router.get(
  "/departments",
  requirePermission(P.EMPLOYEE_VIEW),
  asyncHandler(async (_req, res) => {
    const data = await service.getDepartments();
    return res.json({ success: true, data });
  }),
);

router.post(
  "/",
  requirePermission(P.EMPLOYEE_CREATE),
  asyncHandler(async (req, res) => {
    const data = await service.createEmployee(req, req.body ?? {});
    return res.status(201).json({ success: true, data });
  }),
);

router.get(
  "/:id",
  requirePermission(P.EMPLOYEE_VIEW),
  asyncHandler(async (req, res) => {
    const data = await service.getEmployee(employeeId(req));
    return res.json({ success: true, data });
  }),
);

router.patch(
  "/:id",
  requirePermission(P.EMPLOYEE_UPDATE),
  asyncHandler(async (req, res) => {
    const data = await service.updateEmployee(req, employeeId(req), req.body ?? {});
    return res.json({ success: true, data });
  }),
);

// Changing who holds which role needs ROLE_MANAGE as well as EMPLOYEE_UPDATE —
// editing someone's phone number and granting them permissions are different
// kinds of act and shouldn't come with the same grant.
router.put(
  "/:id/roles",
  requirePermission(P.EMPLOYEE_UPDATE, P.ROLE_MANAGE),
  asyncHandler(async (req, res) => {
    const data = await service.setEmployeeRoles(req, employeeId(req), req.body?.roleIds ?? []);
    return res.json({ success: true, data });
  }),
);

router.post(
  "/:id/status",
  requirePermission(P.EMPLOYEE_DISABLE),
  asyncHandler(async (req, res) => {
    const data = await service.setEmployeeStatus(req, employeeId(req), req.body?.status, req.body?.reason);
    return res.json({ success: true, data });
  }),
);

router.post(
  "/:id/reset-access",
  requirePermission(P.EMPLOYEE_UPDATE),
  asyncHandler(async (req, res) => {
    const data = await service.resetEmployeeAccess(req, employeeId(req), req.body?.reason);
    return res.json({ success: true, data });
  }),
);

router.get(
  "/:id/audit",
  requirePermission(P.EMPLOYEE_VIEW, P.AUDIT_VIEW),
  asyncHandler(async (req, res) => {
    const data = await service.getEmployeeAuditHistory(employeeId(req));
    return res.json({ success: true, data });
  }),
);

router.get(
  "/:id/activity",
  requirePermission(P.EMPLOYEE_VIEW, P.AUDIT_VIEW),
  asyncHandler(async (req, res) => {
    const data = await service.getEmployeeActivity(employeeId(req));
    return res.json({ success: true, data });
  }),
);

export default router;
