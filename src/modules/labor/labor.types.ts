// Public response shapes for the Labor & Kitchen Capacity Engine, plus the
// starter station set. Same convention as forecast.types.ts: the service layer
// returns these, the controller passes them through untouched.

import type { CapacityVerdict, StationConstraint } from "./labor.formulas";

/**
 * Starter stations offered on first use, so an owner isn't staring at an empty
 * screen wondering what a "station" is meant to be. Deliberately a SUGGESTION
 * seeded on explicit request only — never auto-created — because station layout
 * is genuinely restaurant-specific (a South Indian kitchen wants DOSA_TAWA and
 * IDLI_STEAMER, not FRYER) and silently inventing the wrong four would make
 * every labor standard entered against them wrong too.
 *
 * utilizationFactor differs per station for a real reason: a plating pass is
 * occupied almost continuously while the pass is running, whereas a prep bench
 * loses far more of the hour to fetching, washing and putting away.
 */
export const DEFAULT_STATION_SEED: {
  code: string;
  name: string;
  utilizationFactor: number;
  sortOrder: number;
}[] = [
  { code: "PREP", name: "Prep", utilizationFactor: 0.7, sortOrder: 1 },
  { code: "GRILL", name: "Grill", utilizationFactor: 0.75, sortOrder: 2 },
  { code: "FRYER", name: "Fryer", utilizationFactor: 0.8, sortOrder: 3 },
  { code: "CURRY", name: "Curry / Range", utilizationFactor: 0.75, sortOrder: 4 },
  { code: "TANDOOR", name: "Tandoor", utilizationFactor: 0.75, sortOrder: 5 },
  { code: "PLATING", name: "Plating / Pass", utilizationFactor: 0.85, sortOrder: 6 },
];

export interface StationSummary {
  stationId: number;
  code: string;
  name: string;
  utilizationFactor: number | null;
  /** The station's own declared items/hour ceiling. */
  capacityPerHour: number | null;
  /** Σ itemsPerHour across the station's active equipment, or null when none declares a rate. */
  equipmentItemsPerHour: number | null;
  equipmentCount: number;
  /** How many menu items have a labor standard at this station. */
  standardsCount: number;
  /** How many staff are marked able to work it. */
  skilledStaffCount: number;
  sortOrder: number;
  isActive: boolean;
}

// ─── Live kitchen queue (POS order-taking ETA) ────────────────────────────────
// See labor.eta.service.ts for how each figure is derived and why the result
// reports "not configured" rather than guessing.

export interface KitchenQueueStation {
  stationId: number;
  code: string;
  name: string;
  /** Outstanding hands-on minutes already queued at this station. */
  queueMinutes: number;
  /** Outstanding units of food queued here — what the equipment ceiling is compared against. */
  queueItems: number;
  /** Clocked-in staff marked able to work this station. */
  skilledStaffPresent: number;
  /** Parallel workers assumed when splitting the backlog. Floors at 1. */
  lanes: number;
  /** Effective items/hour ceiling (station's own, else summed equipment), or null when unknown. */
  capacityPerHour: number | null;
  /** Backlog ÷ lanes ÷ utilization. */
  laborWaitMinutes: number;
  /** Backlog items ÷ throughput ceiling. 0 when no ceiling is known. */
  equipmentWaitMinutes: number;
  /** The binding one of the two above — the wait a new dish actually joins. */
  waitMinutes: number;
  /** True when the equipment ceiling, not staffing, is what's holding this station up. */
  isEquipmentBound: boolean;
  /** lanes × utilization. Hands-on minutes ÷ this = elapsed minutes, so the client can price a new dish onto the queue the same way the backlog was priced. */
  productiveDivisor: number;
}

export interface KitchenQueueResult {
  /** False = the POS must fall back to plain prepTime and quote no queue adjustment. */
  configured: boolean;
  /** Why it isn't configured — shown to the manager so it's actionable. */
  reason?: string;
  targetTicketMinutes: number;
  openOrders: number;
  /** False when nobody is clocked in, so every station fell back to a single lane. */
  staffDataAvailable: boolean;
  /** Queued units whose item has no labor standard anywhere — real work this estimate can't see. */
  unpricedQueueItems?: number;
  stations: KitchenQueueStation[];
  /** menuItemId → its per-station minutes, so the client can price any item locally. */
  standards: Record<number, { stationId: number; minutes: number }[]>;
  /**
   * menuItemId → MenuItem.prepTime, the whole-dish figure.
   *
   * Present because station splits are routinely INCOMPLETE: an item routed to
   * 3 of 10 stations sums to a fraction of its real cook time (observed at ~58%
   * of prepTime on average), so quoting the sum alone systematically
   * under-promises. The client floors a dish's own cook time at this value, so
   * an incompletely-mapped dish falls back to the time the kitchen already
   * knows, and a fully-mapped one uses the sharper station-aware sum. Improves
   * on its own as standards get filled in — no data migration needed.
   */
  wholeItemMinutes: Record<number, number>;
}

export interface LaborStandardRow {
  menuItemId: number;
  itemName: string;
  categoryName: string | null;
  /** Whole-item prepTime already on MenuItem, shown for reference — NOT the same thing as the station split, and never used by the engine. */
  menuPrepTime: number;
  /** stationId → the standard for this item at that station. Missing key = no standard entered. */
  stations: Record<
    number,
    {
      standardMinutes: number;
      observedMinutes: number | null;
      observationCount: number;
      /** Which figure the engine will actually plan with. */
      effectiveMinutes: number;
      effectiveSource: "observed" | "standard";
    }
  >;
  /** Σ effectiveMinutes across all stations — the item's total hands-on labor. */
  totalStationMinutes: number;
}

export interface SkillMatrixRow {
  userId: number;
  name: string;
  role: string;
  shift: string | null;
  /** stationId → skill. Missing key = cannot work this station. */
  stations: Record<number, { proficiency: number; speedFactor: number }>;
  stationCount: number;
}

/** One 15-minute slice of the analysed day, per station and in total. */
export interface WorkloadBucket {
  /** Minutes from midnight. */
  offsetMinutes: number;
  label: string;
  orders: number;
  workloadMinutes: number;
  /** stationId → workload minutes landing in this slice. */
  perStation: Record<number, number>;
}

export interface StationPlanRow {
  stationId: number;
  code: string;
  name: string;
  workloadMinutes: number;
  itemUnits: number;
  utilizationFactorUsed: number;
  productiveMinutesPerStaff: number;
  /** Raw FTE the workload implies, before any equipment cap. */
  rawRequiredFte: number;
  /** FTE actually worth rostering — capped at what the equipment can produce. */
  requiredFte: number;
  /** requiredFte rounded up, for the simple "Grill — 3" line a manager reads. */
  recommendedHeadcount: number;
  coveredFte: number;
  shortfallFte: number;
  headcount: number;
  constraint: StationConstraint;
  capacityPerHour: number | null;
  equipmentUtilizationPercent: number | null;
  unservableItemsPerHour: number;
  isEquipmentBound: boolean;
  anyoneSkilled: boolean;
  /** Top items driving this station's workload, largest first. */
  topContributors: { menuItemId: number; itemName: string; quantity: number; minutes: number }[];
}

export interface StaffingPlanResponse {
  branchId: number;
  window: {
    fromHour: number;
    toHour: number;
    label: string;
    windowMinutes: number;
  };
  source: {
    /** "FORECAST" projects the trailing history forward; "HISTORICAL" reports the trailing average as-is. */
    basis: "FORECAST" | "HISTORICAL";
    trailingDays: number;
    daysWithData: number;
    ordersObserved: number;
    confidence: "high" | "medium" | "low";
    confidenceReasons: string[];
  };
  demand: {
    expectedOrders: number;
    expectedItems: number;
    /** Items with demand in the window but no labor standard at any station — the engine cannot see their workload, so this is stated rather than silently ignored. */
    itemsMissingStandards: { menuItemId: number; itemName: string; quantity: number }[];
    coveragePercent: number;
  };
  peak: {
    /** Peak load over each rolling window, so a 15-minute rush inside a calm hour is visible. */
    windows: {
      windowMinutes: number;
      label: string;
      startOffsetMinutes: number;
      workloadMinutes: number;
      workloadMinutesPerHour: number;
    }[];
    /** The window the plan is actually solved against — the busiest one. */
    drivingWindowMinutes: number;
    drivingWindowLabel: string;
  };
  stations: StationPlanRow[];
  crew: {
    /** Where the roster came from: clocked-in attendance today, or a caller-supplied hypothetical headcount. */
    basis: "SCHEDULED" | "ASSUMED";
    scheduledCount: number;
    assignments: {
      userId: number;
      name: string;
      stations: { stationId: number; code: string; name: string; fractionOfWindow: number; percentOfWindow: number }[];
      idleFraction: number;
    }[];
    totalShortfallFte: number;
    totalSurplusFte: number;
    unskilledShortfallFte: number;
    /** Headcount the plan recommends, vs. what is rostered. */
    recommendedHeadcount: number;
    shortByHeadcount: number;
    estimatedWindowLaborCost: number | null;
  };
  verdict: {
    verdict: CapacityVerdict;
    headline: string;
    bindingStationCode: string | null;
    /** Concrete next steps, most impactful first. */
    actions: string[];
  };
  buckets: WorkloadBucket[];
  /** Present when the branch has not been configured enough for a real plan. */
  setupWarnings: string[];
  /**
   * False when no station has any workload — i.e. the plan's staffing figures
   * are structurally meaningless rather than merely zero. Clients MUST render
   * "—" instead of 0 for required/shortfall/cost when this is false; a green
   * "short by 0" on an unconfigured branch reads as an all-clear.
   */
  hasModelledWorkload: boolean;
}

export interface CalibrationReportResponse {
  branchId: number;
  trailingDays: number;
  ordersConsidered: number;
  ordersUsable: number;
  maxConcurrencyUsed: number;
  applied: boolean;
  items: {
    menuItemId: number;
    itemName: string;
    factor: number;
    observationCount: number;
    stations: { stationId: number; code: string; standardMinutes: number; suggestedMinutes: number; observedMinutes: number | null; observationCount: number }[];
  }[];
  /** Per-employee throughput context. Explicitly correlational — see labor.learning.service.ts. */
  staffThroughput: {
    userId: number;
    name: string;
    hoursOnShift: number;
    ordersCompletedDuringShift: number;
    ordersPerHour: number;
    branchAverageOrdersPerHour: number;
    /** ordersPerHour ÷ branch average. NOT a speed factor — see the caveat field. */
    relativeIndex: number;
  }[];
  staffThroughputCaveat: string;
}
