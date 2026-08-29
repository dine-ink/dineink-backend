import { Router } from "express";
import prisma from "../../../config/prisma";
import { internalAuth, requirePermission } from "../rbac/internalAuth.middleware";
import { PERMISSIONS as P } from "../rbac/permissions";
import { asyncHandler } from "../shared/apiError";
import { AUDIT_ACTIONS, listAuditLogs } from "./audit.service";

/**
 * Read-only by design. There is no POST, PATCH or DELETE here and there never
 * should be: an audit trail an application can rewrite isn't one.
 */
const router = Router();
router.use(internalAuth);

router.get(
  "/",
  requirePermission(P.AUDIT_VIEW),
  asyncHandler(async (req, res) => {
    const data = await listAuditLogs(req.query as any);
    return res.json({ success: true, data });
  }),
);

router.get(
  "/meta",
  requirePermission(P.AUDIT_VIEW),
  asyncHandler(async (_req, res) => {
    // Resource types are read from what's actually been logged rather than from
    // a hard-coded list, so the filter can't drift out of step with reality.
    const resourceTypes = await prisma.internalAuditLog.findMany({
      distinct: ["resourceType"],
      select: { resourceType: true },
      orderBy: { resourceType: "asc" },
      take: 100,
    });
    return res.json({
      success: true,
      data: {
        actions: Object.values(AUDIT_ACTIONS).sort(),
        resourceTypes: resourceTypes.map((r) => r.resourceType),
      },
    });
  }),
);

export default router;
