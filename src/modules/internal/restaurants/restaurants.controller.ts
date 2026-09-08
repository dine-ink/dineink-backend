import { hasPermission } from "../rbac/internalAuth.middleware";
import { PERMISSIONS } from "../rbac/permissions";
import { AUDIT_ACTIONS, recordAudit } from "../audit/audit.service";
import { listLiveOrders, listOrders } from "../orders/orders.service";
import { listTransactions } from "../transactions/transactions.service";
import { listCustomers } from "../customers/customers.service";
import { asyncHandler, badRequest } from "../shared/apiError";
import * as menuService from "./restaurantMenu.service";
import * as service from "./restaurants.service";
import * as tableService from "./restaurantTables.service";
import * as userService from "./restaurantUsers.service";

const restaurantId = (req: any) => {
  const id = Number(req.params.id ?? req.params.restaurantId);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("That isn't a valid restaurant id.", "INVALID_ID");
  return id;
};

// ─── List & detail ───────────────────────────────────────────────────────────

export const list = asyncHandler(async (req, res) => {
  const data = await service.listRestaurants(req.query as any);
  return res.json({ success: true, data });
});

export const filterOptions = asyncHandler(async (_req, res) => {
  const data = await service.getRestaurantFilterOptions();
  return res.json({ success: true, data });
});

export const detail = asyncHandler(async (req, res) => {
  const data = await service.getRestaurant(restaurantId(req));
  return res.json({ success: true, data });
});

export const financialProfile = asyncHandler(async (req, res) => {
  const data = await service.getRestaurantFinancialProfile(restaurantId(req));
  return res.json({ success: true, data });
});

export const create = asyncHandler(async (req, res) => {
  const data = await service.createRestaurant(req, req.body ?? {});
  return res.status(201).json({ success: true, data });
});

export const update = asyncHandler(async (req, res) => {
  const data = await service.updateRestaurant(req, restaurantId(req), req.body ?? {});
  return res.json({ success: true, data });
});

export const activate = asyncHandler(async (req, res) => {
  const data = await service.activateRestaurant(req, restaurantId(req), req.body?.reason);
  return res.json({ success: true, data });
});

export const suspend = asyncHandler(async (req, res) => {
  const data = await service.suspendRestaurant(req, restaurantId(req), req.body?.reason ?? "");
  return res.json({ success: true, data });
});

export const activity = asyncHandler(async (req, res) => {
  const data = await service.getRestaurantActivity(restaurantId(req));
  return res.json({ success: true, data });
});

// ─── Restaurant users ────────────────────────────────────────────────────────

export const listUsers = asyncHandler(async (req, res) => {
  const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
  const data = await userService.listRestaurantUsers(restaurantId(req), branchId);
  return res.json({ success: true, data });
});

export const createUser = asyncHandler(async (req, res) => {
  const data = await userService.createRestaurantUser(req, restaurantId(req), req.body ?? {});
  return res.status(201).json({ success: true, data });
});

export const updateUser = asyncHandler(async (req, res) => {
  const data = await userService.updateRestaurantUser(
    req,
    restaurantId(req),
    Number(req.params.userId),
    req.body ?? {},
  );
  return res.json({ success: true, data });
});

export const setUserActive = asyncHandler(async (req, res) => {
  const data = await userService.setRestaurantUserActive(
    req,
    restaurantId(req),
    Number(req.params.userId),
    Boolean(req.body?.isActive),
    req.body?.reason,
  );
  return res.json({ success: true, data });
});

export const resetUserAccess = asyncHandler(async (req, res) => {
  const data = await userService.resetRestaurantUserAccess(
    req,
    restaurantId(req),
    Number(req.params.userId),
    req.body?.reason,
  );
  return res.json({ success: true, data });
});

// ─── Menu ────────────────────────────────────────────────────────────────────

export const getMenu = asyncHandler(async (req, res) => {
  const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
  const data = await menuService.getMenu(restaurantId(req), branchId);
  return res.json({ success: true, data });
});

export const updateMenuItem = asyncHandler(async (req, res) => {
  const { reason, ...input } = req.body ?? {};
  if (!reason?.trim()) {
    // A restaurant owns its menu. If DineInk changes it, the restaurant is
    // entitled to know why, so the reason is required rather than optional.
    throw badRequest("Changing a restaurant's menu needs a reason — it's recorded in the audit log.", "REASON_REQUIRED");
  }
  const data = await menuService.updateMenuItem(
    req,
    restaurantId(req),
    Number(req.params.itemId),
    input,
    reason.trim(),
  );
  return res.json({ success: true, data });
});

// ─── Tables & QR ─────────────────────────────────────────────────────────────

export const listTables = asyncHandler(async (req, res) => {
  const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
  const data = await tableService.listTables(restaurantId(req), branchId);
  return res.json({ success: true, data });
});

export const generateQr = asyncHandler(async (req, res) => {
  const data = await tableService.generateQr(req, restaurantId(req), Number(req.params.tableId));
  return res.json({ success: true, data });
});

export const regenerateQr = asyncHandler(async (req, res) => {
  const data = await tableService.regenerateQr(
    req,
    restaurantId(req),
    Number(req.params.tableId),
    req.body?.reason,
  );
  return res.json({ success: true, data });
});

export const setQrEnabled = asyncHandler(async (req, res) => {
  const data = await tableService.setQrEnabled(
    req,
    restaurantId(req),
    Number(req.params.tableId),
    Boolean(req.body?.enabled),
    req.body?.reason,
  );
  return res.json({ success: true, data });
});

export const qrImage = asyncHandler(async (req, res) => {
  const data = await tableService.renderQrImage(restaurantId(req), Number(req.params.tableId));
  return res.json({ success: true, data });
});

// ─── Related records ─────────────────────────────────────────────────────────

export const restaurantOrders = asyncHandler(async (req, res) => {
  const data = await listOrders(
    { ...(req.query as any), restaurantId: restaurantId(req) },
    hasPermission(req, PERMISSIONS.CUSTOMER_PII_VIEW),
  );
  return res.json({ success: true, data });
});

export const restaurantLiveOrders = asyncHandler(async (req, res) => {
  const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
  const data = await listLiveOrders(restaurantId(req), branchId);
  return res.json({ success: true, data });
});

export const restaurantTransactions = asyncHandler(async (req, res) => {
  const data = await listTransactions(
    { ...(req.query as any), restaurantId: restaurantId(req) },
    hasPermission(req, PERMISSIONS.CUSTOMER_PII_VIEW),
  );
  return res.json({ success: true, data });
});

export const restaurantCustomers = asyncHandler(async (req, res) => {
  const canViewPii = hasPermission(req, PERMISSIONS.CUSTOMER_PII_VIEW);
  const data = await listCustomers(
    { ...(req.query as any), restaurantId: restaurantId(req) },
    canViewPii,
  );
  if (canViewPii) {
    // Reading a list of real contact details is itself an access event worth
    // recording — the audit trail should answer "who pulled this restaurant's
    // customer list", not only "who changed something".
    await recordAudit(req, {
      action: AUDIT_ACTIONS.CUSTOMER_PII_VIEWED,
      resourceType: "Restaurant",
      resourceId: restaurantId(req),
      newValue: { scope: "customer-list", count: data.rows.length },
    });
  }
  return res.json({ success: true, data });
});
