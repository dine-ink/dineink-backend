import QRCode from "qrcode";
import prisma from "../../../config/prisma";
import { AUDIT_ACTIONS, auditData } from "../audit/audit.service";
import { invalidState, notFound } from "../shared/apiError";
import { generateQrToken } from "../shared/ids";

/**
 * Tables and their QR codes.
 *
 * The important decision here is what a QR encodes. It is never the table's
 * primary key: `RestaurantTable.id` is a sequential integer, so a key-based QR
 * would let anyone reach any table at any restaurant by counting upward — and
 * the URL under a printed code is, by design, something strangers scan. Each
 * table instead gets an unguessable random token, and regenerating one mints a
 * fresh token that immediately invalidates every printed copy of the old code.
 */

const qrBaseUrl = () =>
  (process.env.CUSTOMER_ORDER_URL || process.env.DINEINK_ORDER_URL || "https://order.dineink.com").replace(/\/$/, "");

export const buildQrUrl = (token: string) => `${qrBaseUrl()}/t/${token}`;

export const listTables = async (restaurantId: number, branchId?: number) => {
  const tables = await prisma.restaurantTable.findMany({
    where: { restaurantId, ...(branchId ? { branchId } : {}) },
    orderBy: [{ branchId: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      capacity: true,
      status: true,
      isTemporary: true,
      qrToken: true,
      qrEnabled: true,
      qrGeneratedAt: true,
      createdAt: true,
      branch: { select: { id: true, name: true } },
    },
  });

  // The last time each table was actually used, from the running-order history
  // — one grouped query rather than one per table.
  const activity = tables.length
    ? await prisma.runningOrder.groupBy({
        by: ["tableId"],
        where: { tableId: { in: tables.map((t) => t.id) } },
        _max: { startedAt: true },
      })
    : [];
  const lastUsed = new Map(activity.map((a) => [a.tableId, a._max.startedAt]));

  return tables.map((table) => ({
    ...table,
    // The token itself is returned only so the console can render and download
    // the code; it is not secret from an employee who can already manage it.
    qrUrl: table.qrToken ? buildQrUrl(table.qrToken) : null,
    lastActivityAt: lastUsed.get(table.id) ?? null,
  }));
};

const loadTable = async (restaurantId: number, tableId: number) => {
  const table = await prisma.restaurantTable.findUnique({ where: { id: tableId } });
  if (!table || table.restaurantId !== restaurantId) {
    throw notFound("That table doesn't belong to this restaurant.", "TABLE_NOT_FOUND");
  }
  return table;
};

export const generateQr = async (req: any, restaurantId: number, tableId: number) => {
  const table = await loadTable(restaurantId, tableId);
  if (table.qrToken) {
    throw invalidState(
      `${table.name} already has a QR code. Use Regenerate if it needs to be replaced.`,
      "QR_EXISTS",
    );
  }

  const token = generateQrToken();
  const [updated] = await prisma.$transaction([
    prisma.restaurantTable.update({
      where: { id: tableId },
      data: { qrToken: token, qrEnabled: true, qrGeneratedAt: new Date() },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.QR_GENERATED,
        resourceType: "RestaurantTable",
        resourceId: tableId,
        resourceLabel: table.name,
        // The token is not written to the audit log — an audit trail that
        // records the secret it is auditing defeats regenerating it.
        newValue: { qrEnabled: true },
      }),
    }),
  ]);

  return { ...updated, qrUrl: buildQrUrl(token) };
};

export const regenerateQr = async (req: any, restaurantId: number, tableId: number, reason?: string) => {
  const table = await loadTable(restaurantId, tableId);
  if (!reason?.trim()) {
    throw invalidState(
      "Regenerating a QR code invalidates every printed copy, so it needs a reason.",
      "REASON_REQUIRED",
    );
  }

  const token = generateQrToken();
  const [updated] = await prisma.$transaction([
    prisma.restaurantTable.update({
      where: { id: tableId },
      data: { qrToken: token, qrEnabled: true, qrGeneratedAt: new Date() },
    }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: AUDIT_ACTIONS.QR_REGENERATED,
        resourceType: "RestaurantTable",
        resourceId: tableId,
        resourceLabel: table.name,
        reason: reason.trim(),
      }),
    }),
  ]);

  return { ...updated, qrUrl: buildQrUrl(token) };
};

export const setQrEnabled = async (
  req: any,
  restaurantId: number,
  tableId: number,
  enabled: boolean,
  reason?: string,
) => {
  const table = await loadTable(restaurantId, tableId);
  if (!table.qrToken) {
    throw invalidState(`${table.name} doesn't have a QR code yet.`, "QR_NOT_GENERATED");
  }
  if (table.qrEnabled === enabled) {
    throw invalidState(`${table.name}'s QR code is already ${enabled ? "enabled" : "disabled"}.`, "NO_CHANGES");
  }

  const [updated] = await prisma.$transaction([
    prisma.restaurantTable.update({ where: { id: tableId }, data: { qrEnabled: enabled } }),
    prisma.internalAuditLog.create({
      data: auditData(req, {
        action: enabled ? AUDIT_ACTIONS.QR_ENABLED : AUDIT_ACTIONS.QR_DISABLED,
        resourceType: "RestaurantTable",
        resourceId: tableId,
        resourceLabel: table.name,
        previousValue: { qrEnabled: table.qrEnabled },
        newValue: { qrEnabled: enabled },
        reason: reason ?? null,
      }),
    }),
  ]);

  return updated;
};

/**
 * Renders the QR as a PNG data URL for download/print. Generated on demand
 * rather than stored — the image is a pure function of the token, so persisting
 * it would only create a second thing to keep in step after a regeneration.
 */
export const renderQrImage = async (restaurantId: number, tableId: number) => {
  const table = await loadTable(restaurantId, tableId);
  if (!table.qrToken) {
    throw invalidState(`${table.name} doesn't have a QR code yet.`, "QR_NOT_GENERATED");
  }
  const url = buildQrUrl(table.qrToken);
  const dataUrl = await QRCode.toDataURL(url, { width: 512, margin: 2, errorCorrectionLevel: "M" });
  return { tableId, tableName: table.name, url, dataUrl, enabled: table.qrEnabled };
};
