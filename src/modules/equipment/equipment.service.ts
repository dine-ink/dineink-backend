import prisma from "../../config/prisma";
import { ForbiddenError } from "./equipment.validation";

// ── Equipment Data List ───────────────────────────────────────────────────────

export const getEquipmentListService = async (restaurantId: number, branchId: number) => {
  return prisma.equipment.findMany({
    where: { restaurantId, branchId },
    include: { emiSchedule: true },
    orderBy: { name: "asc" },
  });
};

export interface EquipmentInput {
  branchId: number;
  name: string;
  category?: string;
  capacity?: string;
  volume?: string;
  itemCapacityCount?: number;
  /**
   * Sustained throughput, items/hour. Distinct from itemCapacityCount above,
   * which is a BATCH size ("6 pizzas fit at once") and cannot yield a wait
   * time on its own. Writable here as well as via
   * PUT /labor/equipment/:id/station so a manager logging a unit on the POS
   * can set its rate in the same form, rather than the rate being reachable
   * only from the labor module. stationId is deliberately NOT accepted here —
   * that stays the labor endpoint's job, so station wiring has one owner.
   */
  itemsPerHour?: number | null;
  powerConsumptionKw?: number;
  purchasePrice?: number;
  purchaseDate?: string;
  emiScheduleId?: number | null;
  installationDate?: string;
  warrantyExpiryDate?: string;
  expectedLifespanMonths?: number;
  serviceProviderName?: string;
  serviceProviderContact?: string;
  nextMaintenanceDate?: string;
  maintenanceNotes?: string;
  createdById?: number;
}

export const createEquipmentService = async (
  callerRestaurantId: number,
  data: EquipmentInput,
) => {
  return prisma.equipment.create({
    data: {
      restaurantId:           callerRestaurantId,
      branchId:               data.branchId,
      name:                   data.name,
      category:               data.category,
      capacity:               data.capacity,
      volume:                 data.volume,
      itemCapacityCount:      data.itemCapacityCount,
      itemsPerHour:           data.itemsPerHour,
      powerConsumptionKw:     data.powerConsumptionKw,
      purchasePrice:          data.purchasePrice,
      purchaseDate:           data.purchaseDate ? new Date(data.purchaseDate) : undefined,
      emiScheduleId:          data.emiScheduleId,
      installationDate:       data.installationDate ? new Date(data.installationDate) : undefined,
      warrantyExpiryDate:     data.warrantyExpiryDate ? new Date(data.warrantyExpiryDate) : undefined,
      expectedLifespanMonths: data.expectedLifespanMonths,
      serviceProviderName:    data.serviceProviderName,
      serviceProviderContact: data.serviceProviderContact,
      nextMaintenanceDate:    data.nextMaintenanceDate ? new Date(data.nextMaintenanceDate) : undefined,
      maintenanceNotes:       data.maintenanceNotes,
      createdById:            data.createdById,
    },
    include: { emiSchedule: true },
  });
};

export interface EquipmentUpdateInput extends Partial<EquipmentInput> {
  isActive?: boolean;
}

export const updateEquipmentService = async (
  callerRestaurantId: number,
  id: number,
  data: EquipmentUpdateInput,
) => {
  const existing = await prisma.equipment.findUnique({ where: { id }, select: { restaurantId: true } });
  if (!existing) throw new Error("Equipment not found");
  if (existing.restaurantId !== callerRestaurantId) throw new ForbiddenError("You do not have access to this equipment");

  return prisma.equipment.update({
    where: { id },
    data: {
      branchId:               data.branchId,
      name:                   data.name,
      category:               data.category,
      capacity:               data.capacity,
      volume:                 data.volume,
      itemCapacityCount:      data.itemCapacityCount,
      itemsPerHour:           data.itemsPerHour,
      powerConsumptionKw:     data.powerConsumptionKw,
      purchasePrice:          data.purchasePrice,
      purchaseDate:           data.purchaseDate ? new Date(data.purchaseDate) : undefined,
      emiScheduleId:          data.emiScheduleId,
      installationDate:       data.installationDate ? new Date(data.installationDate) : undefined,
      warrantyExpiryDate:     data.warrantyExpiryDate ? new Date(data.warrantyExpiryDate) : undefined,
      expectedLifespanMonths: data.expectedLifespanMonths,
      serviceProviderName:    data.serviceProviderName,
      serviceProviderContact: data.serviceProviderContact,
      nextMaintenanceDate:    data.nextMaintenanceDate ? new Date(data.nextMaintenanceDate) : undefined,
      maintenanceNotes:       data.maintenanceNotes,
      isActive:               data.isActive,
    },
    include: { emiSchedule: true },
  });
};

export const deleteEquipmentService = async (callerRestaurantId: number, id: number) => {
  const existing = await prisma.equipment.findUnique({ where: { id }, select: { restaurantId: true } });
  if (!existing) throw new Error("Equipment not found");
  if (existing.restaurantId !== callerRestaurantId) throw new ForbiddenError("You do not have access to this equipment");
  return prisma.equipment.delete({ where: { id } });
};

// ── Maintenance Due ───────────────────────────────────────────────────────────
//
// Surfaces equipment whose next scheduled maintenance falls within the given
// window (default 30 days), flagging rows that are already overdue and rows
// whose warranty is expiring within the same window — both are things an
// owner/manager wants to act on before the equipment fails unexpectedly.

export const getMaintenanceDueService = async (
  restaurantId: number,
  branchId: number,
  withinDays: number = 30,
) => {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);

  // Upper-bounded by windowEnd only (no lower bound at "now") — equipment
  // whose maintenance is already overdue is still "due" and must show up
  // here for isOverdue to ever be true; excluding it would make that flag
  // dead weight.
  const equipment = await prisma.equipment.findMany({
    where: {
      restaurantId,
      branchId,
      isActive: true,
      nextMaintenanceDate: { lte: windowEnd },
    },
    include: { emiSchedule: true },
    orderBy: { nextMaintenanceDate: "asc" },
  });

  return equipment.map((item) => ({
    ...item,
    isOverdue: item.nextMaintenanceDate ? item.nextMaintenanceDate < now : false,
    isWarrantyExpiringSoon:
      !!item.warrantyExpiryDate &&
      item.warrantyExpiryDate >= now &&
      item.warrantyExpiryDate <= windowEnd,
  }));
};
