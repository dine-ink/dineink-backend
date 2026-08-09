import type { EmiSchedule, Equipment, Prisma } from "../../../generated/prisma";
import type { SeedConfig } from "../config";
import type { SeedContext } from "../context";
import { addDays, type Db, chance, indianMobile, pickOne, randomFloat, randomInt, randomMoney, sampleUnique, subDays, weightedPick } from "../utils";

/**
 * Candidate pool of realistic Indian commercial-kitchen equipment. Sized
 * well above the 8-14 items drawn per branch so sampleUnique() gives each
 * branch a genuinely different mix instead of the same list every time.
 * capacityOptions/volumeOptions populate whichever of Equipment.capacity /
 * Equipment.volume actually makes sense for that item (never both) —
 * schema keeps them as separate free-text columns.
 */
interface EquipmentTemplate {
  name: string;
  category: string;
  capacityOptions?: string[];
  volumeOptions?: string[];
  /** Only set for equipment where "how many items it holds" is meaningful (freezers, display counters). */
  itemCapacityCountRange?: [number, number];
  powerConsumptionKwRange: [number, number];
  purchasePriceRange: [number, number];
  expectedLifespanMonthsRange: [number, number];
}

const EQUIPMENT_TEMPLATES: EquipmentTemplate[] = [
  {
    name: "Walk-in Freezer",
    category: "Refrigeration",
    volumeOptions: ["500L", "800L", "1000L"],
    itemCapacityCountRange: [40, 100],
    powerConsumptionKwRange: [3, 8],
    purchasePriceRange: [150_000, 450_000],
    expectedLifespanMonthsRange: [96, 120],
  },
  {
    name: "Walk-in Chiller",
    category: "Refrigeration",
    volumeOptions: ["400L", "600L", "900L"],
    itemCapacityCountRange: [40, 90],
    powerConsumptionKwRange: [2, 5],
    purchasePriceRange: [120_000, 350_000],
    expectedLifespanMonthsRange: [96, 120],
  },
  {
    name: "Deep Freezer (Chest)",
    category: "Refrigeration",
    volumeOptions: ["300L", "400L", "500L"],
    powerConsumptionKwRange: [0.3, 0.8],
    purchasePriceRange: [25_000, 60_000],
    expectedLifespanMonthsRange: [72, 96],
  },
  {
    name: "Ice Cube Machine",
    category: "Refrigeration",
    capacityOptions: ["30kg/day", "50kg/day", "80kg/day"],
    powerConsumptionKwRange: [1, 2.5],
    purchasePriceRange: [60_000, 180_000],
    expectedLifespanMonthsRange: [72, 96],
  },
  {
    name: "Refrigerated Display Counter",
    category: "Refrigeration",
    capacityOptions: ["3ft", "4ft", "6ft"],
    itemCapacityCountRange: [20, 60],
    powerConsumptionKwRange: [0.5, 1.5],
    purchasePriceRange: [45_000, 120_000],
    expectedLifespanMonthsRange: [84, 108],
  },
  {
    name: "Refrigerated Prep Table",
    category: "Refrigeration",
    capacityOptions: ["3ft", "4ft"],
    powerConsumptionKwRange: [0.5, 1],
    purchasePriceRange: [55_000, 130_000],
    expectedLifespanMonthsRange: [84, 108],
  },
  {
    name: "Commercial Gas Range",
    category: "Cooking",
    capacityOptions: ["2-burner", "4-burner", "6-burner"],
    powerConsumptionKwRange: [0.2, 0.5],
    purchasePriceRange: [40_000, 90_000],
    expectedLifespanMonthsRange: [60, 84],
  },
  {
    name: "Commercial Tandoor",
    category: "Cooking",
    capacityOptions: ["Gas-fired", "Charcoal-fired"],
    powerConsumptionKwRange: [1, 3],
    purchasePriceRange: [30_000, 80_000],
    expectedLifespanMonthsRange: [60, 96],
  },
  {
    name: "Deep Fryer",
    category: "Cooking",
    volumeOptions: ["15L oil", "20L oil", "25L oil"],
    powerConsumptionKwRange: [3, 6],
    purchasePriceRange: [20_000, 55_000],
    expectedLifespanMonthsRange: [48, 72],
  },
  {
    name: "Dosa/Tawa Griddle",
    category: "Cooking",
    capacityOptions: ["450mm", "600mm"],
    powerConsumptionKwRange: [2, 4],
    purchasePriceRange: [15_000, 40_000],
    expectedLifespanMonthsRange: [48, 72],
  },
  {
    name: "Commercial Roti/Chapati Maker",
    category: "Cooking",
    powerConsumptionKwRange: [1.5, 3],
    purchasePriceRange: [45_000, 120_000],
    expectedLifespanMonthsRange: [60, 84],
  },
  {
    name: "Dough Mixer (Planetary)",
    category: "Cooking",
    capacityOptions: ["10kg", "20kg", "30kg"],
    powerConsumptionKwRange: [1, 2.5],
    purchasePriceRange: [35_000, 90_000],
    expectedLifespanMonthsRange: [84, 120],
  },
  {
    name: "Commercial Wet Grinder",
    category: "Cooking",
    volumeOptions: ["5L", "10L", "15L"],
    powerConsumptionKwRange: [0.5, 1.5],
    purchasePriceRange: [15_000, 40_000],
    expectedLifespanMonthsRange: [60, 96],
  },
  {
    name: "Commercial Mixer Grinder",
    category: "Cooking",
    volumeOptions: ["3L", "5L"],
    powerConsumptionKwRange: [0.75, 1.5],
    purchasePriceRange: [8_000, 20_000],
    expectedLifespanMonthsRange: [48, 72],
  },
  {
    name: "Commercial Blender/Juicer",
    category: "Cooking",
    powerConsumptionKwRange: [0.5, 1],
    purchasePriceRange: [10_000, 25_000],
    expectedLifespanMonthsRange: [48, 72],
  },
  {
    name: "Exhaust Hood/Chimney",
    category: "Ventilation",
    capacityOptions: ["4ft", "6ft", "8ft"],
    powerConsumptionKwRange: [0.5, 1.5],
    purchasePriceRange: [35_000, 90_000],
    expectedLifespanMonthsRange: [96, 120],
  },
  {
    name: "Kitchen Exhaust Blower",
    category: "Ventilation",
    powerConsumptionKwRange: [1, 2],
    purchasePriceRange: [15_000, 35_000],
    expectedLifespanMonthsRange: [84, 120],
  },
  {
    name: "Commercial Dishwasher",
    category: "Cleaning",
    capacityOptions: ["30 racks/hr", "40 racks/hr", "60 racks/hr"],
    powerConsumptionKwRange: [4, 8],
    purchasePriceRange: [90_000, 250_000],
    expectedLifespanMonthsRange: [72, 120],
  },
  {
    name: "High-Pressure Cleaner",
    category: "Cleaning",
    powerConsumptionKwRange: [1, 2],
    purchasePriceRange: [12_000, 30_000],
    expectedLifespanMonthsRange: [48, 72],
  },
  {
    name: "POS Terminal",
    category: "POS/Billing",
    powerConsumptionKwRange: [0.08, 0.15],
    purchasePriceRange: [15_000, 35_000],
    expectedLifespanMonthsRange: [36, 60],
  },
  {
    name: "Thermal Receipt Printer",
    category: "POS/Billing",
    powerConsumptionKwRange: [0.05, 0.1],
    purchasePriceRange: [8_000, 15_000],
    expectedLifespanMonthsRange: [36, 60],
  },
  {
    name: "Kitchen Order Ticket (KOT) Printer",
    category: "POS/Billing",
    powerConsumptionKwRange: [0.05, 0.1],
    purchasePriceRange: [8_000, 18_000],
    expectedLifespanMonthsRange: [36, 60],
  },
  {
    name: "RO Water Purifier",
    category: "Water Treatment",
    capacityOptions: ["25L/hr", "50L/hr", "100L/hr"],
    powerConsumptionKwRange: [0.1, 0.3],
    purchasePriceRange: [15_000, 45_000],
    expectedLifespanMonthsRange: [60, 96],
  },
  {
    name: "Water Storage Tank & Pump",
    category: "Water Treatment",
    volumeOptions: ["500L", "1000L", "1500L"],
    powerConsumptionKwRange: [0.5, 1],
    purchasePriceRange: [20_000, 45_000],
    expectedLifespanMonthsRange: [84, 120],
  },
];

const SERVICE_PROVIDERS = [
  "ColdChain Services Chennai",
  "TN Refrigeration Repairs",
  "SS Kitchen Equipment Services",
  "Chennai Commercial Kitchen Care",
  "Anna Nagar Appliance Services",
  "South India Catering Equipment Co.",
  "Metro Kitchen Maintenance",
];

const MAINTENANCE_NOTES = [
  "Routine compressor check due",
  "Annual AMC service due",
  "Filter/gasket replacement due",
  "Deep cleaning & inspection due",
  "Gas leak check & burner service due",
  "Motor bearing lubrication due",
  "Calibration & performance check due",
];

/** Which warranty-status bucket a row falls into, and roughly how far the expiry date sits from "now" — mirrors the app's days-until-expiry color coding. */
const WARRANTY_STATUS_MIX = { VALID: 0.4, EXPIRING_SOON: 0.2, EXPIRED: 0.15, NONE: 0.25 };

/** Same idea as WARRANTY_STATUS_MIX but for the "next maintenance due" alert banner. */
const MAINTENANCE_STATUS_MIX = { OVERDUE: 0.2, DUE_SOON: 0.25, FUTURE: 0.35, NONE: 0.2 };

function pickWarrantyExpiryDate(): Date | null {
  const status = weightedPick(WARRANTY_STATUS_MIX);
  const now = new Date();
  switch (status) {
    case "VALID":
      return addDays(now, randomInt(180, 730)); // 6-24 months out
    case "EXPIRING_SOON":
      return addDays(now, randomInt(1, 30));
    case "EXPIRED":
      return subDays(now, randomInt(1, 365));
    default:
      return null;
  }
}

function pickNextMaintenanceDate(): Date | null {
  const status = weightedPick(MAINTENANCE_STATUS_MIX);
  const now = new Date();
  switch (status) {
    case "OVERDUE":
      return subDays(now, randomInt(1, 60));
    case "DUE_SOON":
      return addDays(now, randomInt(1, 14));
    case "FUTURE":
      return addDays(now, randomInt(30, 180));
    default:
      return null;
  }
}

/** Picks an EMI schedule plausible for this branch's equipment: restaurant-wide (branchId null) or scoped to the same branch. */
function pickPlausibleEmiSchedule(emiSchedules: EmiSchedule[], branchId: number): number | null {
  const candidates = emiSchedules.filter((emi) => emi.branchId === null || emi.branchId === branchId);
  if (candidates.length === 0) return null;
  return pickOne(candidates).id;
}

/**
 * Owns: Equipment — 8-14 realistic pieces of commercial-kitchen equipment
 * per branch, drawn from EQUIPMENT_TEMPLATES via sampleUnique() so branches
 * don't all get an identical list. warrantyExpiryDate and
 * nextMaintenanceDate are deliberately distributed across
 * valid/expiring-soon/expired/none (and overdue/due-soon/future/none)
 * buckets rather than randomized uniformly, since the real app color-codes
 * both for a "warranty/maintenance due" alert banner and a flat random
 * range would under-represent the interesting demo cases. ~25-30% of rows
 * link back to an EmiSchedule (from emi.generator.ts, which must run first
 * and hand its result in here) that's plausible for that equipment's
 * branch — either restaurant-wide or scoped to the same branch.
 *
 * Idempotent: generates once per restaurant, checked via a plain count().
 */
export async function generateEquipment(
  db: Db,
  config: SeedConfig,
  ctx: SeedContext,
  emiSchedules: EmiSchedule[],
): Promise<Equipment[]> {
  const existingCount = await db.equipment.count({ where: { restaurantId: ctx.restaurant.id } });
  if (existingCount > 0) {
    return db.equipment.findMany({ where: { restaurantId: ctx.restaurant.id } });
  }

  const rows: Prisma.EquipmentCreateManyInput[] = [];

  for (const branchCtx of ctx.branches) {
    const branchId = branchCtx.branch.id;
    const templates = sampleUnique(EQUIPMENT_TEMPLATES, randomInt(8, 14));

    for (const template of templates) {
      // Purchased sometime in the last 6-24 months — independent of
      // config.history.monthsOfHistory (only 3 months, the bill/inventory
      // window), since equipment is naturally owned for much longer than
      // that. Hardcoded here rather than added to config.ts, which is out
      // of scope for this change.
      const purchaseDate = subDays(new Date(), randomInt(180, 730));
      const installationDate = addDays(purchaseDate, randomInt(1, 10));
      const hasServiceProvider = chance(0.6);
      const nextMaintenanceDate = pickNextMaintenanceDate();

      rows.push({
        restaurantId: ctx.restaurant.id,
        branchId,
        name: template.name,
        category: template.category,
        capacity: template.capacityOptions ? pickOne(template.capacityOptions) : null,
        volume: template.volumeOptions ? pickOne(template.volumeOptions) : null,
        itemCapacityCount: template.itemCapacityCountRange
          ? randomInt(template.itemCapacityCountRange[0], template.itemCapacityCountRange[1])
          : null,
        powerConsumptionKw: randomFloat(template.powerConsumptionKwRange[0], template.powerConsumptionKwRange[1], 2),
        purchasePrice: randomMoney(template.purchasePriceRange[0], template.purchasePriceRange[1]),
        purchaseDate,
        emiScheduleId: chance(0.28) ? pickPlausibleEmiSchedule(emiSchedules, branchId) : null,
        installationDate,
        warrantyExpiryDate: pickWarrantyExpiryDate(),
        expectedLifespanMonths: randomInt(template.expectedLifespanMonthsRange[0], template.expectedLifespanMonthsRange[1]),
        serviceProviderName: hasServiceProvider ? pickOne(SERVICE_PROVIDERS) : null,
        serviceProviderContact: hasServiceProvider ? indianMobile() : null,
        nextMaintenanceDate,
        maintenanceNotes: nextMaintenanceDate ? pickOne(MAINTENANCE_NOTES) : null,
        isActive: true,
        createdById: ctx.owner.id,
      });
    }
  }

  return db.equipment.createManyAndReturn({ data: rows });
}
