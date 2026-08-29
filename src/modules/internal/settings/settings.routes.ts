import { Router } from "express";
import prisma from "../../../config/prisma";
import { internalAuth, requirePermission } from "../rbac/internalAuth.middleware";
import { PERMISSIONS as P } from "../rbac/permissions";
import { AUDIT_ACTIONS, auditData } from "../audit/audit.service";
import { asyncHandler, invalidState, notFound } from "../shared/apiError";
import { invalidateSettingsCache } from "./platformSettings.service";

const router = Router();
router.use(internalAuth);

router.get(
  "/",
  requirePermission(P.SETTINGS_VIEW),
  asyncHandler(async (req, res) => {
    const where = req.query.group ? { group: String(req.query.group) } : {};
    const settings = await prisma.platformSetting.findMany({ where, orderBy: [{ group: "asc" }, { key: "asc" }] });

    // Grouped for the settings screen's tabs (Company, Business, Payments,
    // Notifications, Security), which is how they're presented rather than as
    // one flat list of keys.
    const grouped = settings.reduce<Record<string, typeof settings>>((acc, setting) => {
      (acc[setting.group] ??= []).push(setting);
      return acc;
    }, {});

    return res.json({ success: true, data: { grouped, settings } });
  }),
);

router.put(
  "/:key",
  requirePermission(P.SETTINGS_MANAGE),
  asyncHandler(async (req, res) => {
    const key = req.params.key;
    const existing = await prisma.platformSetting.findUnique({ where: { key } });
    if (!existing) {
      // Settings are seeded, not created ad hoc — an unknown key is a typo, and
      // silently creating it would produce a setting nothing reads.
      throw notFound(`There's no setting called "${key}".`, "SETTING_NOT_FOUND");
    }
    if (req.body?.value === undefined) throw invalidState("Provide a value.", "VALUE_REQUIRED");

    const [updated] = await prisma.$transaction([
      prisma.platformSetting.update({
        where: { key },
        data: { value: req.body.value, updatedById: req.internal.id },
      }),
      prisma.internalAuditLog.create({
        data: auditData(req, {
          action: AUDIT_ACTIONS.SETTING_CHANGED,
          resourceType: "PlatformSetting",
          resourceId: key,
          resourceLabel: key,
          previousValue: { value: existing.value },
          newValue: { value: req.body.value },
          reason: req.body?.reason ?? null,
        }),
      }),
    ]);

    invalidateSettingsCache();
    return res.json({ success: true, data: updated });
  }),
);

// ─── Feature flags ───────────────────────────────────────────────────────────

router.get(
  "/feature-flags/all",
  requirePermission(P.SETTINGS_VIEW),
  asyncHandler(async (_req, res) => {
    const data = await prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
    return res.json({ success: true, data });
  }),
);

router.put(
  "/feature-flags/:key",
  requirePermission(P.FEATURE_FLAG_MANAGE),
  asyncHandler(async (req, res) => {
    const key = req.params.key;
    const existing = await prisma.featureFlag.findUnique({ where: { key } });
    if (!existing) throw notFound(`There's no feature flag called "${key}".`, "FLAG_NOT_FOUND");

    const isEnabled = Boolean(req.body?.isEnabled);
    if (existing.isEnabled === isEnabled) {
      throw invalidState(`${existing.name} is already ${isEnabled ? "on" : "off"}.`, "NO_CHANGES");
    }

    const [updated] = await prisma.$transaction([
      prisma.featureFlag.update({ where: { key }, data: { isEnabled, updatedById: req.internal.id } }),
      prisma.internalAuditLog.create({
        data: auditData(req, {
          action: AUDIT_ACTIONS.FEATURE_FLAG_CHANGED,
          resourceType: "FeatureFlag",
          resourceId: key,
          resourceLabel: existing.name,
          previousValue: { isEnabled: existing.isEnabled },
          newValue: { isEnabled },
          reason: req.body?.reason ?? null,
        }),
      }),
    ]);

    return res.json({ success: true, data: updated });
  }),
);

export default router;
