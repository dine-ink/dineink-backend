import { Router } from "express";
import { internalAuth, requirePermission } from "../rbac/internalAuth.middleware";
import { PERMISSIONS as P } from "../rbac/permissions";
import { asyncHandler, badRequest, notFound } from "../shared/apiError";
import { AUDIT_ACTIONS, recordAudit } from "../audit/audit.service";
import { getPlatformAnalytics } from "./analytics.service";
import { getSystemHealth } from "../system/systemHealth.service";
import { getLog, getLogMeta, listLogs } from "../logs/logs.service";
import { availableReports, buildReport, toCsv } from "../reports/reports.service";

/**
 * Analytics, reports, system health and application logs.
 *
 * Grouped in one router because each is a small read-only surface; splitting
 * them into four modules would be four files of boilerplate around one endpoint
 * apiece.
 */
const router = Router();
router.use(internalAuth);

// ─── Platform analytics ──────────────────────────────────────────────────────
router.get(
  "/analytics/platform",
  requirePermission(P.ANALYTICS_VIEW),
  asyncHandler(async (req, res) => {
    const data = await getPlatformAnalytics(req.internal.permissions, req.query);
    return res.json({ success: true, data });
  }),
);

// ─── Reports ─────────────────────────────────────────────────────────────────
router.get(
  "/reports",
  requirePermission(P.REPORT_VIEW),
  asyncHandler(async (req, res) =>
    res.json({ success: true, data: availableReports(req.internal.permissions) }),
  ),
);

/** Preview on screen — capped, and no audit entry: this is a read. */
router.get(
  "/reports/:key",
  requirePermission(P.REPORT_VIEW),
  asyncHandler(async (req, res) => {
    const report = await buildReport(req.params.key, req.query, req.internal.permissions);
    return res.json({
      success: true,
      data: { ...report, rows: report.rows.slice(0, 100), previewOf: report.rowCount },
    });
  }),
);

/**
 * Download. Needs REPORT_EXPORT on top of REPORT_VIEW, and is audited — the
 * point of separating the two grants is that leaving with the data is the part
 * worth having a record of.
 */
router.get(
  "/reports/:key/export",
  requirePermission(P.REPORT_VIEW, P.REPORT_EXPORT),
  asyncHandler(async (req, res) => {
    const report = await buildReport(req.params.key, req.query, req.internal.permissions);

    await recordAudit(req, {
      action: AUDIT_ACTIONS.REPORT_EXPORTED,
      resourceType: "Report",
      resourceId: req.params.key,
      resourceLabel: req.params.key,
      newValue: { rows: report.rowCount, from: req.query.from ?? null, to: req.query.to ?? null },
    });

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="dineink-${req.params.key}-${stamp}.csv"`);
    // Excel opens a bare UTF-8 CSV as the system codepage and mangles any
    // non-ASCII name; the BOM is what makes it read the file correctly.
    return res.send("﻿" + toCsv(report));
  }),
);

// ─── System health ───────────────────────────────────────────────────────────
router.get(
  "/system/health",
  requirePermission(P.SYSTEM_HEALTH_VIEW),
  asyncHandler(async (_req, res) => {
    const data = await getSystemHealth();
    return res.json({ success: true, data });
  }),
);

// ─── Application logs ────────────────────────────────────────────────────────
router.get(
  "/logs",
  requirePermission(P.LOG_VIEW),
  asyncHandler(async (req, res) => {
    const data = await listLogs(req.query as any);
    return res.json({ success: true, data });
  }),
);

router.get(
  "/logs/meta",
  requirePermission(P.LOG_VIEW),
  asyncHandler(async (_req, res) => res.json({ success: true, data: await getLogMeta() })),
);

router.get(
  "/logs/:id",
  requirePermission(P.LOG_VIEW),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest("That is not a valid log id.", "INVALID_ID");
    const data = await getLog(id);
    if (!data) throw notFound("No log entry with that id.", "LOG_NOT_FOUND");
    return res.json({ success: true, data });
  }),
);

export default router;
