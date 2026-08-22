// Labor & Kitchen Capacity Engine — configuration CRUD: kitchen stations, the
// per-item/per-station labor standards, and the staff skill matrix. The analysis
// itself lives in labor.engine.service.ts; this file only reads and writes the
// three tables the engine consumes.
//
// Tenant isolation: routes carrying :restaurantId are gated by
// requireOwnRestaurant in labor.routes.ts. Functions that take a bare row id
// (update/delete, where the URL has no restaurantId) re-check ownership here
// and throw ForbiddenError — the same split equipment.service.ts uses.

import prisma from "../../config/prisma";
import { runChunkedWrites } from "./labor.batch";
import { ForbiddenError, ValidationError } from "./labor.validation";
import { resolveEffectiveMinutes, type StationTimeStandard } from "./labor.formulas";
import { DEFAULT_STATION_SEED, type LaborStandardRow, type SkillMatrixRow, type StationSummary } from "./labor.types";

// ─── Ownership helpers ────────────────────────────────────────────────────────

const assertOwnedStation = async (callerRestaurantId: number, stationId: number) => {
  const station = await prisma.kitchenStation.findUnique({
    where: { id: stationId },
    select: { id: true, restaurantId: true, branchId: true },
  });
  if (!station) throw new ValidationError("Kitchen station not found");
  if (station.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this kitchen station");
  }
  return station;
};

const assertOwnedMenuItem = async (callerRestaurantId: number, menuItemId: number) => {
  const item = await prisma.menuItem.findUnique({
    where: { id: menuItemId },
    select: { id: true, restaurantId: true },
  });
  if (!item) throw new ValidationError("Menu item not found");
  if (item.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this menu item");
  }
  return item;
};

const assertOwnedUser = async (callerRestaurantId: number, userId: number) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, restaurantId: true },
  });
  if (!user) throw new ValidationError("Staff member not found");
  if (user.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this staff member");
  }
  return user;
};

// ─── 1. Stations ──────────────────────────────────────────────────────────────

/**
 * Stations for a branch, each with its equipment throughput rollup and how far
 * its configuration has actually been filled in. The counts matter as much as
 * the station itself: a station with zero labor standards contributes nothing
 * to the engine, and the UI needs to say so rather than showing a confident
 * zero-workload plan.
 */
export const listStationsService = async (
  restaurantId: number,
  branchId: number,
  includeInactive = false,
): Promise<StationSummary[]> => {
  const stations = await prisma.kitchenStation.findMany({
    where: { restaurantId, branchId, ...(includeInactive ? {} : { isActive: true }) },
    include: {
      equipment: { where: { isActive: true }, select: { id: true, itemsPerHour: true } },
      _count: { select: { menuItemTimes: true, staffSkills: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return stations.map((s) => {
    const ratedEquipment = s.equipment.filter((e) => e.itemsPerHour && e.itemsPerHour > 0);
    return {
      stationId: s.id,
      code: s.code,
      name: s.name,
      utilizationFactor: s.utilizationFactor,
      capacityPerHour: s.capacityPerHour,
      // Null (not 0) when no unit declares a rate — 0 would read as "this
      // station can produce nothing", which would make every station with
      // unrated equipment look permanently equipment-bound.
      equipmentItemsPerHour: ratedEquipment.length
        ? ratedEquipment.reduce((sum, e) => sum + (e.itemsPerHour || 0), 0)
        : null,
      equipmentCount: s.equipment.length,
      standardsCount: s._count.menuItemTimes,
      skilledStaffCount: s._count.staffSkills,
      sortOrder: s.sortOrder,
      isActive: s.isActive,
    };
  });
};

export interface StationInput {
  branchId: number;
  name: string;
  code: string;
  utilizationFactor?: number | null;
  capacityPerHour?: number | null;
  sortOrder?: number;
  createdById?: number;
}

export const createStationService = async (callerRestaurantId: number, data: StationInput) => {
  const branch = await prisma.branch.findUnique({
    where: { id: data.branchId },
    select: { id: true, restaurantId: true },
  });
  if (!branch) throw new ValidationError("Branch not found");
  if (branch.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this branch");
  }

  // Caught explicitly rather than left to the unique constraint so the message
  // names the conflict — the code is normalised (see validateStationCode), so
  // "Wood Fired Oven" and "WOOD_FIRED_OVEN" collide here on purpose.
  const clash = await prisma.kitchenStation.findUnique({
    where: { branchId_code: { branchId: data.branchId, code: data.code } },
    select: { id: true, isActive: true },
  });
  if (clash) throw new ValidationError(`A station with code '${data.code}' already exists at this branch`);

  return prisma.kitchenStation.create({
    data: {
      restaurantId: callerRestaurantId,
      branchId: data.branchId,
      name: data.name,
      code: data.code,
      utilizationFactor: data.utilizationFactor ?? null,
      capacityPerHour: data.capacityPerHour ?? null,
      sortOrder: data.sortOrder ?? 0,
      createdById: data.createdById,
    },
  });
};

export interface StationUpdateInput {
  name?: string;
  utilizationFactor?: number | null;
  capacityPerHour?: number | null;
  sortOrder?: number;
  isActive?: boolean;
}

// `code` is intentionally NOT updatable: labor standards and skills are joined
// on the station id, but seeded defaults and any future import/export are keyed
// on code, and silently renaming it would make those two views disagree about
// which station is which. Delete and recreate to change a code.
export const updateStationService = async (
  callerRestaurantId: number,
  stationId: number,
  data: StationUpdateInput,
) => {
  await assertOwnedStation(callerRestaurantId, stationId);
  return prisma.kitchenStation.update({
    where: { id: stationId },
    data: {
      name: data.name,
      utilizationFactor: data.utilizationFactor,
      capacityPerHour: data.capacityPerHour,
      sortOrder: data.sortOrder,
      isActive: data.isActive,
    },
  });
};

/**
 * Deletes a station and, by cascade, its labor standards and skill rows.
 * Equipment assigned to it is NOT deleted — the FK is ON DELETE SET NULL, so
 * purchase price, EMI linkage and warranty survive. The returned counts let the
 * UI warn about what is about to be lost before this is called.
 */
export const deleteStationService = async (callerRestaurantId: number, stationId: number) => {
  await assertOwnedStation(callerRestaurantId, stationId);
  const counts = await prisma.kitchenStation.findUnique({
    where: { id: stationId },
    select: { _count: { select: { menuItemTimes: true, staffSkills: true, equipment: true } } },
  });
  await prisma.kitchenStation.delete({ where: { id: stationId } });
  return {
    deleted: true,
    removedStandards: counts?._count.menuItemTimes ?? 0,
    removedSkills: counts?._count.staffSkills ?? 0,
    unassignedEquipment: counts?._count.equipment ?? 0,
  };
};

/**
 * Creates any of the starter stations that don't already exist at this branch.
 * Explicitly invoked, never automatic — see DEFAULT_STATION_SEED's comment for
 * why guessing a kitchen's layout would be worse than an empty screen. Idempotent:
 * re-running it adds only what's missing and never touches an existing station's
 * tuning.
 */
export const seedDefaultStationsService = async (
  callerRestaurantId: number,
  branchId: number,
  createdById?: number,
) => {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { id: true, restaurantId: true },
  });
  if (!branch) throw new ValidationError("Branch not found");
  if (branch.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this branch");
  }

  const existing = await prisma.kitchenStation.findMany({
    where: { branchId },
    select: { code: true },
  });
  const existingCodes = new Set(existing.map((s) => s.code));
  const missing = DEFAULT_STATION_SEED.filter((s) => !existingCodes.has(s.code));

  if (missing.length) {
    await prisma.kitchenStation.createMany({
      data: missing.map((s) => ({
        restaurantId: callerRestaurantId,
        branchId,
        code: s.code,
        name: s.name,
        utilizationFactor: s.utilizationFactor,
        sortOrder: s.sortOrder,
        createdById,
      })),
    });
  }

  return { created: missing.length, skipped: DEFAULT_STATION_SEED.length - missing.length };
};

/** Assigns equipment to a station and/or sets its sustained throughput, so station ceilings can be derived from the equipment register instead of re-typed. */
export const assignEquipmentToStationService = async (
  callerRestaurantId: number,
  equipmentId: number,
  stationId: number | null,
  itemsPerHour: number | null,
) => {
  const equipment = await prisma.equipment.findUnique({
    where: { id: equipmentId },
    select: { id: true, restaurantId: true, branchId: true },
  });
  if (!equipment) throw new ValidationError("Equipment not found");
  if (equipment.restaurantId !== callerRestaurantId) {
    throw new ForbiddenError("You do not have access to this equipment");
  }

  if (stationId !== null) {
    const station = await assertOwnedStation(callerRestaurantId, stationId);
    // Cross-branch assignment would roll a unit's throughput into another
    // branch's ceiling — silently inflating capacity at a kitchen that doesn't
    // physically have the machine.
    if (station.branchId !== equipment.branchId) {
      throw new ValidationError("Equipment and station must belong to the same branch");
    }
  }

  return prisma.equipment.update({
    where: { id: equipmentId },
    data: { stationId, itemsPerHour },
    select: { id: true, name: true, stationId: true, itemsPerHour: true },
  });
};

// ─── 2. Labor standards (menu item × station minutes) ─────────────────────────

/**
 * The full labor-standards matrix for a branch: one row per menu item, one
 * column per station. Returns EVERY available menu item, not just those with
 * standards entered — the gaps are the actionable part, since an item with no
 * standard is invisible to the workload calculation.
 */
export const listLaborStandardsService = async (
  restaurantId: number,
  branchId: number,
): Promise<{ stations: StationSummary[]; rows: LaborStandardRow[]; itemsWithNoStandards: number }> => {
  const stations = await listStationsService(restaurantId, branchId);
  const stationIds = stations.map((s) => s.stationId);

  const [items, standards] = await Promise.all([
    // Branch-scoped OR restaurant-wide items (branchId null = available at
    // every branch), matching how the menu itself is scoped.
    prisma.menuItem.findMany({
      where: {
        restaurantId,
        isDeleted: false,
        OR: [{ branchId }, { branchId: null }],
      },
      select: {
        id: true,
        name: true,
        prepTime: true,
        category: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
    // Skipped entirely rather than queried with an empty IN list when the
    // branch has no stations yet — every row would be filtered out anyway.
    stationIds.length
      ? prisma.menuItemStationTime.findMany({ where: { stationId: { in: stationIds } } })
      : Promise.resolve<StationTimeStandard[]>([]),
  ]);

  const byItem = new Map<number, StationTimeStandard[]>();
  standards.forEach((s) => {
    const list = byItem.get(s.menuItemId);
    if (list) list.push(s);
    else byItem.set(s.menuItemId, [s]);
  });

  let itemsWithNoStandards = 0;
  const rows: LaborStandardRow[] = items.map((item) => {
    const itemStandards = byItem.get(item.id) ?? [];
    const stationMap: LaborStandardRow["stations"] = {};
    let total = 0;

    itemStandards.forEach((s) => {
      const { minutes, source } = resolveEffectiveMinutes(s);
      stationMap[s.stationId] = {
        standardMinutes: s.standardMinutes,
        observedMinutes: s.observedMinutes,
        observationCount: s.observationCount,
        effectiveMinutes: minutes,
        effectiveSource: source,
      };
      total += minutes;
    });

    if (total <= 0) itemsWithNoStandards++;

    return {
      menuItemId: item.id,
      itemName: item.name,
      categoryName: item.category?.name ?? null,
      menuPrepTime: item.prepTime,
      stations: stationMap,
      totalStationMinutes: Math.round(total * 10) / 10,
    };
  });

  return { stations, rows, itemsWithNoStandards };
};

/**
 * Upsert one labor standard. Writing 0 keeps the row (an explicit "this item
 * doesn't touch this station"); the caller deletes to actually remove it.
 *
 * observedMinutes/observationCount are deliberately left alone on update — an
 * owner correcting their standard must not wipe the calibration history that
 * was measured against it.
 */
export const upsertLaborStandardService = async (
  callerRestaurantId: number,
  menuItemId: number,
  stationId: number,
  standardMinutes: number,
) => {
  await Promise.all([
    assertOwnedMenuItem(callerRestaurantId, menuItemId),
    assertOwnedStation(callerRestaurantId, stationId),
  ]);

  return prisma.menuItemStationTime.upsert({
    where: { menuItemId_stationId: { menuItemId, stationId } },
    create: { menuItemId, stationId, standardMinutes },
    update: { standardMinutes },
  });
};

/**
 * Bulk upsert — one row-edit in the matrix UI touches several stations at once,
 * and doing that as N round trips would leave a half-saved row visible if one
 * failed. Wrapped in a transaction so a row saves completely or not at all.
 */
export const bulkUpsertLaborStandardsService = async (
  callerRestaurantId: number,
  entries: { menuItemId: number; stationId: number; standardMinutes: number }[],
) => {
  if (!entries.length) return { upserted: 0 };

  const menuItemIds = [...new Set(entries.map((e) => e.menuItemId))];
  const stationIds = [...new Set(entries.map((e) => e.stationId))];

  // Ownership verified for the whole batch up front, in two queries rather than
  // per entry.
  const [ownedItems, ownedStations] = await Promise.all([
    prisma.menuItem.findMany({
      where: { id: { in: menuItemIds }, restaurantId: callerRestaurantId },
      select: { id: true },
    }),
    prisma.kitchenStation.findMany({
      where: { id: { in: stationIds }, restaurantId: callerRestaurantId },
      select: { id: true },
    }),
  ]);
  if (ownedItems.length !== menuItemIds.length) {
    throw new ForbiddenError("One or more menu items do not belong to this restaurant");
  }
  if (ownedStations.length !== stationIds.length) {
    throw new ForbiddenError("One or more stations do not belong to this restaurant");
  }

  // Chunked rather than one transaction over all 2000 possible entries — see
  // labor.batch.ts for why a single large transaction reliably times out
  // against a remote database.
  const { applied } = await runChunkedWrites(
    entries.map((e) => (tx) =>
      tx.menuItemStationTime.upsert({
        where: { menuItemId_stationId: { menuItemId: e.menuItemId, stationId: e.stationId } },
        create: { menuItemId: e.menuItemId, stationId: e.stationId, standardMinutes: e.standardMinutes },
        update: { standardMinutes: e.standardMinutes },
      }),
    ),
  );

  return { upserted: applied };
};

export const deleteLaborStandardService = async (
  callerRestaurantId: number,
  menuItemId: number,
  stationId: number,
) => {
  await assertOwnedStation(callerRestaurantId, stationId);
  await prisma.menuItemStationTime.deleteMany({ where: { menuItemId, stationId } });
  return { deleted: true };
};

/**
 * Splits a menu item's existing whole-item prepTime across stations by a caller
 * supplied weighting, as a starting point for the matrix. Purely a data-entry
 * convenience: 200 menu items × 6 stations is 1,200 cells to type, and an
 * owner-supplied split of a number they already entered is a far better
 * starting point than zero. The result is an ordinary editable standard with no
 * special status.
 */
export const seedStandardsFromPrepTimeService = async (
  callerRestaurantId: number,
  branchId: number,
  weights: { stationId: number; weight: number }[],
  overwriteExisting: boolean,
) => {
  const stationIds = weights.map((w) => w.stationId);
  const ownedStations = await prisma.kitchenStation.findMany({
    where: { id: { in: stationIds }, restaurantId: callerRestaurantId, branchId },
    select: { id: true },
  });
  if (ownedStations.length !== stationIds.length) {
    throw new ForbiddenError("One or more stations do not belong to this restaurant/branch");
  }

  const totalWeight = weights.reduce((s, w) => s + Math.max(0, w.weight), 0);
  if (totalWeight <= 0) throw new ValidationError("At least one station weight must be greater than zero");

  const items = await prisma.menuItem.findMany({
    where: {
      restaurantId: callerRestaurantId,
      isDeleted: false,
      prepTime: { gt: 0 },
      OR: [{ branchId }, { branchId: null }],
    },
    select: { id: true, prepTime: true },
  });

  const existing = overwriteExisting
    ? []
    : await prisma.menuItemStationTime.findMany({
        where: { stationId: { in: stationIds } },
        select: { menuItemId: true, stationId: true },
      });
  const existingKeys = new Set(existing.map((e) => `${e.menuItemId}:${e.stationId}`));

  const entries: { menuItemId: number; stationId: number; standardMinutes: number }[] = [];
  items.forEach((item) => {
    weights.forEach((w) => {
      if (w.weight <= 0) return;
      if (existingKeys.has(`${item.id}:${w.stationId}`)) return;
      entries.push({
        menuItemId: item.id,
        stationId: w.stationId,
        standardMinutes: Math.round(((item.prepTime * w.weight) / totalWeight) * 100) / 100,
      });
    });
  });

  if (!entries.length) return { seeded: 0, itemsTouched: 0 };

  // A 120-item menu across 10 stations is ~420 upserts here, and more on a
  // larger menu — chunked for the reasons in labor.batch.ts.
  const { applied } = await runChunkedWrites(
    entries.map((e) => (tx) =>
      tx.menuItemStationTime.upsert({
        where: { menuItemId_stationId: { menuItemId: e.menuItemId, stationId: e.stationId } },
        create: e,
        update: { standardMinutes: e.standardMinutes },
      }),
    ),
  );

  return { seeded: applied, itemsTouched: new Set(entries.map((e) => e.menuItemId)).size };
};

// ─── 3. Skill matrix ──────────────────────────────────────────────────────────

/**
 * Staff × station capability grid for a branch. Includes every active
 * non-deleted staff member at the branch, so the gaps (someone with no station
 * skills at all) are visible — an unskilled roster is exactly what turns a
 * staffing shortfall into a training problem rather than a hiring one.
 */
export const listSkillMatrixService = async (
  restaurantId: number,
  branchId: number,
): Promise<{ stations: StationSummary[]; rows: SkillMatrixRow[]; staffWithNoSkills: number }> => {
  const stations = await listStationsService(restaurantId, branchId);
  const stationIds = stations.map((s) => s.stationId);

  const staff = await prisma.user.findMany({
    where: { restaurantId, branchId, isActive: true, isDeleted: false },
    select: {
      id: true,
      name: true,
      role: true,
      shift: true,
      stationSkills: stationIds.length
        ? { where: { stationId: { in: stationIds } }, select: { stationId: true, proficiency: true, speedFactor: true } }
        : false,
    },
    orderBy: { name: "asc" },
  });

  let staffWithNoSkills = 0;
  const rows: SkillMatrixRow[] = staff.map((s) => {
    const skills = (s.stationSkills || []) as { stationId: number; proficiency: number; speedFactor: number }[];
    const stationMap: SkillMatrixRow["stations"] = {};
    skills.forEach((k) => {
      stationMap[k.stationId] = { proficiency: k.proficiency, speedFactor: k.speedFactor };
    });
    if (!skills.length) staffWithNoSkills++;
    return {
      userId: s.id,
      name: s.name,
      role: s.role,
      shift: s.shift,
      stations: stationMap,
      stationCount: skills.length,
    };
  });

  return { stations, rows, staffWithNoSkills };
};

export const upsertSkillService = async (
  callerRestaurantId: number,
  userId: number,
  stationId: number,
  proficiency: number,
  speedFactor: number,
) => {
  await Promise.all([
    assertOwnedUser(callerRestaurantId, userId),
    assertOwnedStation(callerRestaurantId, stationId),
  ]);

  return prisma.staffStationSkill.upsert({
    where: { userId_stationId: { userId, stationId } },
    create: { userId, stationId, proficiency, speedFactor },
    update: { proficiency, speedFactor },
  });
};

/** Removes a capability. Absence of a row is the only way to say "cannot work here" — see StaffStationSkill.proficiency's comment on why a stored 0 isn't used for this. */
export const deleteSkillService = async (
  callerRestaurantId: number,
  userId: number,
  stationId: number,
) => {
  await assertOwnedStation(callerRestaurantId, stationId);
  await prisma.staffStationSkill.deleteMany({ where: { userId, stationId } });
  return { deleted: true };
};
