import { Request, Response } from "express";
import { getCapacitySweepService, getStaffingPlanService } from "./labor.engine.service";
import { getCalibrationReportService } from "./labor.learning.service";
import {
  assignEquipmentToStationService,
  bulkUpsertLaborStandardsService,
  createStationService,
  deleteLaborStandardService,
  deleteSkillService,
  deleteStationService,
  listLaborStandardsService,
  listSkillMatrixService,
  listStationsService,
  seedDefaultStationsService,
  seedStandardsFromPrepTimeService,
  updateStationService,
  upsertLaborStandardService,
  upsertSkillService,
} from "./labor.service";
import {
  ForbiddenError,
  ValidationError,
  validateBooleanFlag,
  validateHour,
  validateId,
  validateMinutes,
  validateNonEmptyString,
  validateOptionalId,
  validateOptionalPositiveInt,
  validateOptionalTrailingDays,
  validateOptionalUtilizationFactor,
  validateProficiency,
  validateSpeedFactor,
  validateStationCode,
} from "./labor.validation";

// Same handle() wrapper the forecast module uses, plus a 403 arm for
// ForbiddenError (thrown when a row is looked up by its own id and turns out to
// belong to another restaurant).
const handle = (fn: (req: Request, res: Response) => Promise<any>) => async (req: Request, res: Response) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) return res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error instanceof ForbiddenError) {
      return res.status(403).json({ success: false, message: error.message });
    }
    console.log(error);
    return res.status(500).json({ success: false, message: "Labor & capacity operation failed" });
  }
};

const callerRestaurantId = (req: Request): number => {
  const id = (req as any).user?.restaurantId;
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) throw new ValidationError("Your account is not linked to a restaurant");
  return n;
};

// ─── Stations ─────────────────────────────────────────────────────────────────

export const getStations = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateId(req.params.branchId, "branchId");
  const includeInactive = validateBooleanFlag(req.query.includeInactive, false);
  return listStationsService(restaurantId, branchId, includeInactive);
});

export const createStation = handle(async (req) => {
  const restaurantId = callerRestaurantId(req);
  return createStationService(restaurantId, {
    branchId: validateId(req.body.branchId, "branchId"),
    name: validateNonEmptyString(req.body.name, "name"),
    code: validateStationCode(req.body.code ?? req.body.name),
    utilizationFactor: validateOptionalUtilizationFactor(req.body.utilizationFactor),
    capacityPerHour: validateOptionalPositiveInt(req.body.capacityPerHour, "capacityPerHour"),
    sortOrder: Number(req.body.sortOrder) || 0,
    createdById: (req as any).user?.id,
  });
});

export const updateStation = handle(async (req) => {
  const restaurantId = callerRestaurantId(req);
  const stationId = validateId(req.params.stationId, "stationId");
  return updateStationService(restaurantId, stationId, {
    name: req.body.name !== undefined ? validateNonEmptyString(req.body.name, "name") : undefined,
    utilizationFactor:
      req.body.utilizationFactor !== undefined
        ? validateOptionalUtilizationFactor(req.body.utilizationFactor)
        : undefined,
    capacityPerHour:
      req.body.capacityPerHour !== undefined
        ? validateOptionalPositiveInt(req.body.capacityPerHour, "capacityPerHour")
        : undefined,
    sortOrder: req.body.sortOrder !== undefined ? Number(req.body.sortOrder) || 0 : undefined,
    isActive: req.body.isActive !== undefined ? validateBooleanFlag(req.body.isActive, true) : undefined,
  });
});

export const deleteStation = handle(async (req) => {
  const restaurantId = callerRestaurantId(req);
  return deleteStationService(restaurantId, validateId(req.params.stationId, "stationId"));
});

export const seedStations = handle(async (req) => {
  const restaurantId = callerRestaurantId(req);
  return seedDefaultStationsService(
    restaurantId,
    validateId(req.body.branchId, "branchId"),
    (req as any).user?.id,
  );
});

export const assignEquipment = handle(async (req) => {
  const restaurantId = callerRestaurantId(req);
  return assignEquipmentToStationService(
    restaurantId,
    validateId(req.params.equipmentId, "equipmentId"),
    validateOptionalId(req.body.stationId, "stationId"),
    validateOptionalPositiveInt(req.body.itemsPerHour, "itemsPerHour"),
  );
});

// ─── Labor standards ──────────────────────────────────────────────────────────

export const getLaborStandards = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateId(req.params.branchId, "branchId");
  return listLaborStandardsService(restaurantId, branchId);
});

export const upsertLaborStandard = handle(async (req) => {
  const restaurantId = callerRestaurantId(req);
  return upsertLaborStandardService(
    restaurantId,
    validateId(req.body.menuItemId, "menuItemId"),
    validateId(req.body.stationId, "stationId"),
    validateMinutes(req.body.standardMinutes, "standardMinutes"),
  );
});

export const bulkUpsertLaborStandards = handle(async (req) => {
  const restaurantId = callerRestaurantId(req);
  const raw = req.body.entries;
  if (!Array.isArray(raw)) throw new ValidationError("'entries' must be an array");
  if (raw.length > 2000) throw new ValidationError("'entries' is limited to 2000 rows per request");
  const entries = raw.map((e: any) => ({
    menuItemId: validateId(e.menuItemId, "menuItemId"),
    stationId: validateId(e.stationId, "stationId"),
    standardMinutes: validateMinutes(e.standardMinutes, "standardMinutes"),
  }));
  return bulkUpsertLaborStandardsService(restaurantId, entries);
});

export const deleteLaborStandard = handle(async (req) => {
  const restaurantId = callerRestaurantId(req);
  return deleteLaborStandardService(
    restaurantId,
    validateId(req.params.menuItemId, "menuItemId"),
    validateId(req.params.stationId, "stationId"),
  );
});

export const seedStandardsFromPrepTime = handle(async (req) => {
  const restaurantId = callerRestaurantId(req);
  const branchId = validateId(req.body.branchId, "branchId");
  const raw = req.body.weights;
  if (!Array.isArray(raw) || !raw.length) throw new ValidationError("'weights' must be a non-empty array");
  const weights = raw.map((w: any) => ({
    stationId: validateId(w.stationId, "stationId"),
    weight: validateMinutes(w.weight, "weight"),
  }));
  const overwriteExisting = validateBooleanFlag(req.body.overwriteExisting, false);
  return seedStandardsFromPrepTimeService(restaurantId, branchId, weights, overwriteExisting);
});

// ─── Skill matrix ─────────────────────────────────────────────────────────────

export const getSkillMatrix = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateId(req.params.branchId, "branchId");
  return listSkillMatrixService(restaurantId, branchId);
});

export const upsertSkill = handle(async (req) => {
  const restaurantId = callerRestaurantId(req);
  return upsertSkillService(
    restaurantId,
    validateId(req.body.userId, "userId"),
    validateId(req.body.stationId, "stationId"),
    validateProficiency(req.body.proficiency),
    validateSpeedFactor(req.body.speedFactor),
  );
});

export const deleteSkill = handle(async (req) => {
  const restaurantId = callerRestaurantId(req);
  return deleteSkillService(
    restaurantId,
    validateId(req.params.userId, "userId"),
    validateId(req.params.stationId, "stationId"),
  );
});

// ─── Engine ───────────────────────────────────────────────────────────────────

export const getStaffingPlan = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateId(req.params.branchId, "branchId");

  const fromHour = validateHour(req.query.fromHour, "fromHour", 18);
  const toHour = validateHour(req.query.toHour, "toHour", 22);
  if (toHour < fromHour) throw new ValidationError("'toHour' must be the same as or later than 'fromHour'");

  const basis = req.query.basis === "HISTORICAL" ? "HISTORICAL" : "FORECAST";
  const planWindowMinutes = validateOptionalPositiveInt(req.query.planWindowMinutes, "planWindowMinutes") ?? 60;
  const assumedHeadcount = validateOptionalPositiveInt(req.query.assumedHeadcount, "assumedHeadcount");

  return getStaffingPlanService(restaurantId, branchId, {
    fromHour,
    toHour,
    trailingDays: validateOptionalTrailingDays(req.query.days, 30),
    basis,
    planWindowMinutes,
    assumedHeadcount,
  });
});

export const getCapacitySweep = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateId(req.params.branchId, "branchId");
  return getCapacitySweepService(
    restaurantId,
    branchId,
    validateOptionalTrailingDays(req.query.days, 30),
  );
});

export const getCalibration = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateId(req.params.branchId, "branchId");
  return getCalibrationReportService(
    restaurantId,
    branchId,
    validateOptionalTrailingDays(req.query.days, 60),
    false,
  );
});

// Applying calibration WRITES to observedMinutes, so it is a POST rather than a
// flag on the GET above — a report anyone can pull must not be able to mutate
// labor standards as a side effect of being viewed.
export const applyCalibration = handle(async (req) => {
  const restaurantId = validateId(req.params.restaurantId, "restaurantId");
  const branchId = validateId(req.params.branchId, "branchId");
  return getCalibrationReportService(
    restaurantId,
    branchId,
    validateOptionalTrailingDays(req.body.days, 60),
    true,
  );
});
