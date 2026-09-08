import { Router } from "express";
import { internalAuth } from "../rbac/internalAuth.middleware";
import { asyncHandler, badRequest } from "../shared/apiError";
import { globalSearch } from "../search/globalSearch.service";
import { listEngineeringIssues } from "../tickets/tickets.service";
import { PERMISSIONS as P } from "../rbac/permissions";
import { requirePermission } from "../rbac/internalAuth.middleware";
import { getDashboard } from "./dashboard.service";

const router = Router();
router.use(internalAuth);

/**
 * The dashboard needs no specific permission — every employee gets one — but
 * what it contains is decided by what they hold. An employee with no analytics
 * or restaurant permissions still gets a page, just a sparse one, rather than a
 * permission error on their landing screen.
 */
router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const data = await getDashboard(req, req.internal.permissions, req.query);
    return res.json({ success: true, data });
  }),
);

router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const term = String(req.query.q ?? "");
    if (!term.trim()) throw badRequest("Type something to search for.", "QUERY_REQUIRED");
    const data = await globalSearch(req, term, req.internal.permissions);
    return res.json({ success: true, data });
  }),
);

router.get(
  "/engineering/issues",
  requirePermission(P.ENGINEERING_ISSUE_VIEW),
  asyncHandler(async (req, res) => {
    const data = await listEngineeringIssues(req, req.query);
    return res.json({ success: true, data });
  }),
);

export default router;
