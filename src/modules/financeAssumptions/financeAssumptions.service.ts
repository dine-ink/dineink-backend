import prisma from "../../config/prisma";
import {
  ASSUMPTION_FIELDS,
  AssumptionField,
  AssumptionUpdatePayload,
  AssumptionValues,
  ResolvedAssumptions,
} from "./financeAssumptions.types";

const emptyValues = (): AssumptionValues => {
  const values = {} as AssumptionValues;
  for (const field of ASSUMPTION_FIELDS) values[field] = null;
  return values;
};

const pickValues = (row: Record<string, any> | null): AssumptionValues => {
  const values = emptyValues();
  if (!row) return values;
  for (const field of ASSUMPTION_FIELDS) {
    values[field] = row[field] ?? null;
  }
  return values;
};

/** The restaurant-level default row (branchId = null), raw — no merge. Null-filled if never configured. */
export const getRestaurantDefaultsService = async (restaurantId: number): Promise<AssumptionValues> => {
  const row = await prisma.financialAssumptions.findFirst({ where: { restaurantId, branchId: null } });
  return pickValues(row);
};

/** The branch's own override row, raw — no merge with the restaurant default. Null-filled if never configured. */
export const getBranchOverridesService = async (
  restaurantId: number,
  branchId: number,
): Promise<AssumptionValues> => {
  const row = await prisma.financialAssumptions.findUnique({
    where: { restaurantId_branchId: { restaurantId, branchId } },
  });
  return pickValues(row);
};

/**
 * The canonical read used by the finance engine and everything built on
 * top of it: restaurant default merged with the branch's override,
 * field-by-field (a non-null branch value wins; otherwise fall back to the
 * restaurant default, which itself may be null if never configured).
 */
export const getResolvedAssumptionsService = async (
  restaurantId: number,
  branchId: number,
): Promise<ResolvedAssumptions> => {
  const [defaults, override] = await Promise.all([
    getRestaurantDefaultsService(restaurantId),
    getBranchOverridesService(restaurantId, branchId),
  ]);

  const resolved = emptyValues();
  const overriddenFields: AssumptionField[] = [];
  for (const field of ASSUMPTION_FIELDS) {
    if (override[field] !== null) {
      resolved[field] = override[field];
      overriddenFields.push(field);
    } else {
      resolved[field] = defaults[field];
    }
  }

  return { ...resolved, restaurantId, branchId, overriddenFields };
};

/**
 * Upserts the restaurant-level default row. There's no database constraint
 * enforcing "one default row per restaurant" (see the schema comment on
 * FinancialAssumptions) — this find-then-update-or-create is what actually
 * enforces it, so this function must always be used instead of a raw
 * prisma.financialAssumptions.create for the default row.
 */
export const upsertRestaurantDefaultsService = async (
  restaurantId: number,
  payload: AssumptionUpdatePayload,
  updatedById?: number,
): Promise<AssumptionValues> => {
  const existing = await prisma.financialAssumptions.findFirst({ where: { restaurantId, branchId: null } });
  const data = { ...payload, updatedById };

  const row = existing
    ? await prisma.financialAssumptions.update({ where: { id: existing.id }, data })
    : await prisma.financialAssumptions.create({ data: { restaurantId, branchId: null, ...data } });

  return pickValues(row);
};

/** Upserts a branch's override row, using the DB-enforced (restaurantId, branchId) unique key. */
export const upsertBranchOverridesService = async (
  restaurantId: number,
  branchId: number,
  payload: AssumptionUpdatePayload,
  updatedById?: number,
): Promise<AssumptionValues> => {
  const data = { ...payload, updatedById };
  const row = await prisma.financialAssumptions.upsert({
    where: { restaurantId_branchId: { restaurantId, branchId } },
    update: data,
    create: { restaurantId, branchId, ...data },
  });
  return pickValues(row);
};
