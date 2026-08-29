import { Router } from "express";
import { internalAuth, requirePermission } from "../rbac/internalAuth.middleware";
import { PERMISSIONS as P } from "../rbac/permissions";
import { asyncHandler, badRequest } from "../shared/apiError";
import * as service from "./roles.service";

const router = Router();
router.use(internalAuth);

const roleId = (req: any) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("That isn't a valid role id.", "INVALID_ID");
  return id;
};

router.get(
  "/",
  requirePermission(P.ROLE_VIEW),
  asyncHandler(async (_req, res) => {
    const data = await service.listRoles();
    return res.json({ success: true, data });
  }),
);

router.get(
  "/permissions",
  requirePermission(P.ROLE_VIEW),
  asyncHandler(async (_req, res) => res.json({ success: true, data: service.getPermissionCatalog() })),
);

router.post(
  "/",
  requirePermission(P.ROLE_MANAGE),
  asyncHandler(async (req, res) => {
    const data = await service.createRole(req, req.body ?? {});
    return res.status(201).json({ success: true, data });
  }),
);

router.get(
  "/:id",
  requirePermission(P.ROLE_VIEW),
  asyncHandler(async (req, res) => {
    const data = await service.getRole(roleId(req));
    return res.json({ success: true, data });
  }),
);

router.patch(
  "/:id",
  requirePermission(P.ROLE_MANAGE),
  asyncHandler(async (req, res) => {
    const data = await service.updateRole(req, roleId(req), req.body ?? {});
    return res.json({ success: true, data });
  }),
);

router.put(
  "/:id/permissions",
  requirePermission(P.ROLE_MANAGE),
  asyncHandler(async (req, res) => {
    const data = await service.setRolePermissions(req, roleId(req), req.body?.permissions ?? []);
    return res.json({ success: true, data });
  }),
);

router.delete(
  "/:id",
  requirePermission(P.ROLE_MANAGE),
  asyncHandler(async (req, res) => {
    await service.deleteRole(req, roleId(req));
    return res.json({ success: true });
  }),
);

export default router;
